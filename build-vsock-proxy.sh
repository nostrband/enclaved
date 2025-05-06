#!/bin/bash

# build raw-ip-over-vsock proxies to be used inside
# enclaves for transparent networking.

mkdir -p build
nix --extra-experimental-features nix-command --extra-experimental-features flakes --accept-flake-config build -v .#gnu.vsock-proxy.uncompressed
chmod +x build/vsock/*
rsync -av result/bin/* build/vsock/
echo "Done"
ls -l build/vsock

# cd build
# git clone --filter=blob:none --no-checkout https://github.com/marlinprotocol/oyster-monorepo/
# cd oyster-monorepo
# git checkout 001645fd4b459a6a84d8d8107ef98e188f1e1b4f
# nix --extra-experimental-features nix-command --extra-experimental-features flakes --accept-flake-config build -v .#gnu.networking.raw-proxy.uncompressed
# cd ../
# mkdir -p vsock
# rsync -av oyster-monorepo/result/bin/ vsock/
# echo "Done"
# ls -l vsock