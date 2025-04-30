use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::os::unix::io::{AsRawFd, RawFd};
use std::process::exit;
use std::time::Duration;
use tun_tap::Tun;
use vsock::VsockStream;

const TUN_NAME: &str = "br0"; // The name of the TUN device
const VSCK_PATH: &str = "/dev/vsock"; // Path to the vsock device

fn read_packet_from_vsock(vsock_stream: &mut VsockStream) -> Result<Vec<u8>, std::io::Error> {
    let mut buf = Vec::new();
    vsock_stream.read_to_end(&mut buf)?;
    Ok(buf)
}

fn forward_to_tun(tun_fd: RawFd, packet: &[u8]) -> Result<(), std::io::Error> {
    let mut tun_device = unsafe { std::fs::File::from_raw_fd(tun_fd) };
    tun_device.write_all(packet)?;
    Ok(())
}

fn main() -> Result<(), std::io::Error> {
    // Open /dev/vsock for reading
    let mut vsock_device = VsockStream::connect("16:1080")?;
    let tun_fd = Tun::open(TUN_NAME).unwrap().as_raw_fd();

    println!("Starting packet forwarding from vsock to TUN");

    loop {
        // Read packet from /dev/vsock
        let packet = read_packet_from_vsock(&mut vsock_device)?;

        // Forward the packet to the TUN device
        if let Err(e) = forward_to_tun(tun_fd, &packet) {
            eprintln!("Error forwarding packet to TUN: {:?}", e);
        }
    }

    Ok(())
}
