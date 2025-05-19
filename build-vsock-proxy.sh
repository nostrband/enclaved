#!/bin/bash

# build raw-ip-over-vsock proxies to be used inside
# enclaves for transparent networking.

mkdir -p build/vsock
nix --extra-experimental-features nix-command --extra-experimental-features flakes --accept-flake-config build -v .#gnu.vsock-proxy.uncompressed
chmod +x build/vsock/*
rsync -av result/bin/* build/vsock/
echo "Done"
ls -l build/vsock
