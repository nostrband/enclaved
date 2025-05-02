// Summarizing NAT insights
//
// v1: track (src_port, dst_addr, dst_port)
// or any form of stateful NAT for that matter
//
// 1. tracking and assigning ports is a headache
// 2. does not easily scale to many threads and I want to avoid tokio/async if possible
// 3. there should be a fast path
//
// Host does not have any real services running on it
// Therefore, we have a lot of latitude in port assignment
//
// Let us direct map some port ranges directly to skip lookups
// 80, 443, 1024-61439 of enclave -> 80, 443, 1024-61439 of host
//
// Connections to and from the enclave now work directly
// More importantly, we do not need a stateful NAT!
// This means no lookups affecting performance
// This also means the NAT can easily be multi threaded without needing locks
//
// On the enclave, we set ephemeral ports to stay within the same range
// It seems to already be the case in my local system, the max is 60999
//
// Only downside - some ports need to be reserved for the host to use
// 61440-65535 is available for that
// This means the enclave cannot use these ports to reach the internet
// While this should not be an issue in most cases since ephemeral ports do not extend there
// and most applications use ports lower than ephemeral, it _is_ a breaking change

use clap::Parser;
use nfq::{Queue, Verdict};
use socket2::{SockAddr, Socket};
use std::net::Ipv4Addr;
use byteorder::{BigEndian, ByteOrder};

use oyster_raw_proxy::{
    new_nfq_with_backoff, new_vsock_socket_with_backoff, ProxyError, SocketError, VsockAddrParser,
};

#[derive(Parser)]
#[clap(author, version, about, long_about = None)]
struct Cli {
    /// vsock address to forward packets to <cid:port>
    #[clap(short, long, value_parser = VsockAddrParser{})]
    vsock_addr: SockAddr,
    /// nfqueue number of the listener <num>
    #[clap(short, long, value_parser)]
    queue_num: u16,
}

// Helper function to calculate the checksum for an IP header
fn checksum(data: &[u8]) -> u16 {
    let mut sum: u32 = 0;

    // Process each 16-bit word (2 bytes)
    for chunk in data.chunks(2) {
        let word = if chunk.len() == 2 {
            BigEndian::read_u16(chunk)
        } else {
            (chunk[0] as u16) << 8
        };
        sum = sum.wrapping_add(word as u32);
    }

    // Add carry if any
    while sum >> 16 != 0 {
        sum = (sum & 0xFFFF) + (sum >> 16);
    }

    // Return the one's complement of the sum
    !(sum as u16)
}

// Modify source IP and recalculate checksum
fn set_source_ip(buf: &mut [u8], new_source_ip: Ipv4Addr) {
  const IP_HEADER_LEN: usize = 20;
  const SRC_IP_OFFSET: usize = 12;
  const CHECKSUM_OFFSET: usize = 10;

  let new_ip_bytes = new_source_ip.octets();

  // Change source IP
  buf[SRC_IP_OFFSET..SRC_IP_OFFSET + 4].copy_from_slice(&new_ip_bytes);

  // Zero the checksum before recalculating
  buf[CHECKSUM_OFFSET..CHECKSUM_OFFSET + 2].copy_from_slice(&[0, 0]);

  // Recalculate checksum over the IP header
  let checksum_val = checksum(&buf[..IP_HEADER_LEN]);

  // Write new checksum into header
  buf[CHECKSUM_OFFSET] = (checksum_val >> 8) as u8;
  buf[CHECKSUM_OFFSET + 1] = (checksum_val & 0xFF) as u8;
}

// fn main() {
//     // Example packet in byte buffer (IPv4 packet with source IP 192.168.1.1)
//     let mut buf: Vec<u8> = vec![
//         0x45, 0x00, 0x00, 0x3c, 0x1c, 0x46, 0x40, 0x00, 0x40, 0x06, 0x39, 0x10, // IP Header (part)
//         0xc0, 0xa8, 0x01, 0x01, // Old source IP: 192.168.1.1
//         0x8c, 0x3a, 0x2a, 0x12, // Destination IP (example)
//         // (other parts of the packet follow...)
//     ];

//     // Define the new source IP
//     let new_source_ip = Ipv4Addr::new(10, 0, 0, 1); // 10.0.0.1

//     // Modify the packet
//     modify_ip_packet(&mut buf, new_source_ip);

//     // Print the modified packet (in hexadecimal form)
//     println!("{:x?}", buf);
// }

fn handle_conn(conn_socket: &mut Socket, queue: &mut Queue, ip: &str) -> Result<(), ProxyError> {
    loop {
        let mut msg = queue
            .recv()
            .map_err(SocketError::ReadError)
            .map_err(ProxyError::NfqError)?;

        let mut buf = msg.get_payload_mut();
        let size = buf.len();

        let dst_addr = buf[16..20].iter().fold(String::new(), |acc, val| {
          if acc != "" {
              acc + "." + &val.to_string()
          } else {
              acc + &val.to_string()
          }
        });

        println!("outgoing {:?} to {:?}: {:02x?} ", size, dst_addr, &buf);

        let src_addr = buf[12..16].iter().fold(String::new(), |acc, val| {
          if acc != "" {
              acc + "." + &val.to_string()
          } else {
              acc + &val.to_string()
          }
        });

        if src_addr != ip {
          let new_ip: Ipv4Addr = ip.parse().expect("Invalid IP address");
          set_source_ip(&mut buf, new_ip);
          println!("source_ip changed from {:?}: {:02x?} ", src_addr, &buf);
        }

        // send through vsock
        let mut total_sent = 0;
        while total_sent < size {
            let size = conn_socket
                .send(&buf[total_sent..size])
                .map_err(SocketError::WriteError)
                .map_err(ProxyError::VsockError)?;
            total_sent += size;
        }

        // verdicts
        msg.set_verdict(Verdict::Drop);
        queue
            .verdict(msg)
            .map_err(|e| SocketError::VerdictError(Verdict::Drop, e))
            .map_err(ProxyError::NfqError)?;
    }
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    let ip = std::fs::read_to_string("/app/ip.txt")?.trim().to_owned();

    // nfqueue for incoming packets
    let queue_addr = cli.queue_num;
    let mut queue = new_nfq_with_backoff(queue_addr);

    // get vsock socket
    let vsock_addr = &cli.vsock_addr;
    let mut vsock_socket = new_vsock_socket_with_backoff(vsock_addr);

    loop {
        // do proxying
        // on errors, simply reset the erroring socket
        match handle_conn(&mut vsock_socket, &mut queue, &ip) {
            Ok(_) => {
                // should never happen!
                unreachable!("connection handler exited without error");
            }
            Err(err @ ProxyError::NfqError(_)) => {
                println!("{:?}", anyhow::Error::from(err));

                // get nfqueue
                queue = new_nfq_with_backoff(queue_addr);
            }
            Err(err @ ProxyError::VsockError(_)) => {
                println!("{:?}", anyhow::Error::from(err));

                // get vsock socket
                vsock_socket = new_vsock_socket_with_backoff(vsock_addr);
            }
            Err(err) => {
                // should never happen!
                unreachable!("connection handler exited with unknown error {err:?}");
            }
        }
    }
}