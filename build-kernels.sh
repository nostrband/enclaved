#!/bin/bash

# Build custom new kernel for nitro_cli with some kernel
# flags enabled. This enables transparent networking 
# from inside the enclaves. Kernel blobs must be
# deployed using deploy-kernels.sh for nitro_cli to build 
# and run enclaves.

mkdir -p build
cd build
echo "REWRITE to use aws repo directly with our own patches"
# git clone --filter=blob:none --no-checkout https://github.com/marlinprotocol/oyster-monorepo/
# cd oyster-monorepo
# git checkout 001645fd4b459a6a84d8d8107ef98e188f1e1b4f
# nix --extra-experimental-features nix-command --extra-experimental-features flakes --accept-flake-config build -v .#gnu.kernels.tuna.default
# cd ../
# mkdir -p kernels
# rsync -av oyster-monorepo/result/x86_64/* kernels/
# echo "Done"
# ls -l kernels