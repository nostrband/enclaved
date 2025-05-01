// https://raw.githubusercontent.com/marlinprotocol/oyster-monorepo/refs/heads/master/networking/raw-proxy/src/vsock_to_ip_raw_incoming.rs
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

use std::io::Read;

use clap::Parser;
use socket2::{SockAddr, Socket};
use tun_tap::{Iface, Mode};
use std::fs::File;
use std::io::Write;
use std::os::fd::AsRawFd;
use std::os::fd::FromRawFd;

use oyster_raw_proxy::{
    accept_vsock_conn_with_backoff, new_vsock_server_with_backoff,
    ProxyError, SocketError, VsockAddrParser,
};

#[derive(Parser)]
#[clap(author, version, about, long_about = None)]
struct Cli {
    /// vsock address to listen on <cid:port>
    #[clap(short, long, value_parser = VsockAddrParser{})]
    vsock_addr: SockAddr,
    /// network device to forward packets on
    #[clap(short, long, value_parser)]
    device: String,
}

fn handle_conn(
    conn_socket: &mut Socket,
    tun_writer: &mut File,
    ip: &str,
) -> Result<(), ProxyError> {
    let mut buf = vec![0u8; 65535].into_boxed_slice();

    loop {
        // read till total size
        conn_socket
            .read_exact(&mut buf[0..4])
            .map_err(SocketError::ReadError)
            .map_err(ProxyError::VsockError)?;

        let size: usize = u16::from_be_bytes(buf[2..4].try_into().unwrap()).into();

        // read till full frame
        conn_socket
            .read_exact(&mut buf[4..size])
            .map_err(SocketError::ReadError)
            .map_err(ProxyError::VsockError)?;

        // get the destination IP
        // filter out packets not matching the expected IP
        let dst_addr = buf[16..20].iter().fold(String::new(), |acc, val| {
            if acc != "" {
                acc + "." + &val.to_string()
            } else {
                acc + &val.to_string()
            }
        });
        if dst_addr != ip {
            continue;
        }

        tun_writer
            .write_all(&buf)
            .map_err(SocketError::WriteError)
            .map_err(ProxyError::IpError)?;

        // // send through ip sock
        // let mut total_sent = 0;
        // while total_sent < size {
        //     let size = ip_socket
        //         .send_to(
        //             &buf[total_sent..size],
        //             // port does not matter
        //             &internal_addr,
        //         )
        //         .map_err(SocketError::WriteError)
        //         .map_err(ProxyError::IpError)?;
        //     total_sent += size;
        // }
    }
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    // get ip
    let ip = std::fs::read_to_string("/app/ip.txt")?.trim().to_owned();

    // get ip socket
    let device = &cli.device;
    // let mut ip_socket = new_ip_socket_with_backoff(device);
    // Open the TUN device
    let iface = Iface::new(device, Mode::Tun)?;
    let tun_fd = iface.as_raw_fd();

    let mut tun_writer = unsafe { File::from_raw_fd(tun_fd) };

    // set up incoming vsock socket for incoming packets
    let vsock_addr = &cli.vsock_addr;
    let vsock_socket = new_vsock_server_with_backoff(vsock_addr);

    // get conn socket
    let mut conn_socket = accept_vsock_conn_with_backoff((vsock_addr, &vsock_socket));

    loop {
        // do proxying
        // on errors, simply reset the erroring socket
        match handle_conn(&mut conn_socket, &mut tun_writer, &ip) {
            Ok(_) => {
                // should never happen!
                unreachable!("connection handler exited without error");
            }
            // Err(err @ ProxyError::IpError(_)) => {
            //     println!("{:?}", anyhow::Error::from(err));

            //     // get ip socket
            //     // ip_socket = new_ip_socket_with_backoff(device);
            // }
            Err(err @ ProxyError::VsockError(_)) => {
                println!("{:?}", anyhow::Error::from(err));

                // get conn socket
                conn_socket = accept_vsock_conn_with_backoff((vsock_addr, &vsock_socket));
            }
            Err(err) => {
                // should never happen!
                unreachable!("connection handler exited with unknown error {err:?}");
            }
        }
    }
}


// use std::io::{Read, Write};
// use std::os::fd::{FromRawFd, AsRawFd};
// use std::fs::File;

// use tun_tap::{Iface, Mode};
// use vsock::{VsockStream};
// use nix::sys::socket::{SockAddr};

// fn read_packet_from_vsock(stream: &mut VsockStream) -> std::io::Result<Vec<u8>> {
//     let mut len_buf = [0u8; 2];
//     stream.read_exact(&mut len_buf)?;
//     let len = u16::from_be_bytes(len_buf) as usize;

//     let mut buf = vec![0u8; len];
//     stream.read_exact(&mut buf)?;
//     Ok(buf)
// }

// fn main() -> std::io::Result<()> {
//     // Open the TUN device
//     let iface = Iface::new("tun0", Mode::Tun)?;
//     let tun_fd = iface.as_raw_fd();

//     // Create a SockAddr with CID 16 and port 1080
//     let sock_addr = SockAddr::new_vsock(16, 1080);

//     // Connect to /dev/vsock
//     let mut vsock_stream = VsockStream::connect(&sock_addr)?;

//     println!("Forwarding packets from vsock to TUN...");

//     loop {
//         let packet = read_packet_from_vsock(&mut vsock_stream)?;
//         let mut tun_writer = unsafe { File::from_raw_fd(tun_fd) };
//         tun_writer.write_all(&packet)?;
//         std::mem::forget(tun_writer); // Prevent fd from being closed
//     }
// }
