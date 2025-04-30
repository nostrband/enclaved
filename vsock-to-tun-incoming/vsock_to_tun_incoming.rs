use std::io::{Read, Write};
use std::os::fd::{FromRawFd, AsRawFd};
use std::fs::File;

use tun_tap::{Iface, Mode};
use vsock::{VsockStream};
use nix::sys::socket::{SockAddr};

fn read_packet_from_vsock(stream: &mut VsockStream) -> std::io::Result<Vec<u8>> {
    let mut len_buf = [0u8; 2];
    stream.read_exact(&mut len_buf)?;
    let len = u16::from_be_bytes(len_buf) as usize;

    let mut buf = vec![0u8; len];
    stream.read_exact(&mut buf)?;
    Ok(buf)
}

fn main() -> std::io::Result<()> {
    // Open the TUN device
    let iface = Iface::new("tun0", Mode::Tun)?;
    let tun_fd = iface.as_raw_fd();

    // Create a SockAddr with CID 16 and port 1080
    let sock_addr = SockAddr::new_vsock(16, 1080);

    // Connect to /dev/vsock
    let mut vsock_stream = VsockStream::connect(&sock_addr)?;

    println!("Forwarding packets from vsock to TUN...");

    loop {
        let packet = read_packet_from_vsock(&mut vsock_stream)?;
        let mut tun_writer = unsafe { File::from_raw_fd(tun_fd) };
        tun_writer.write_all(&packet)?;
        std::mem::forget(tun_writer); // Prevent fd from being closed
    }
}
