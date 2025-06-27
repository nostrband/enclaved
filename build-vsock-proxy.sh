#!/bin/bash

# build raw-ip-over-vsock proxies to be used inside
# enclaves for transparent networking.

mkdir -p build/vsock
nix --extra-experimental-features nix-command --extra-experimental-features flakes --accept-flake-config build -v .#musl.vsock-proxy.uncompressed
rm -Rf build/vsock/*
rsync -av result/bin/* build/vsock/
sudo chown ec2-user:ec2-user build/vsock/*
chmod u+w build/vsock/*
chmod +x build/vsock/*
echo "Done"
ls -l build/vsock
