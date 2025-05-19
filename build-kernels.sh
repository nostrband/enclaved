#!/bin/bash

# Build custom new kernel for nitro_cli with some kernel
# flags enabled. This enables transparent networking 
# from inside the enclaves. Kernel blobs must be
# deployed using deploy-kernels.sh for nitro_cli to build 
# and run enclaves.

mkdir -p build
cd build
git clone --filter=blob:none --no-checkout https://github.com/aws/aws-nitro-enclaves-sdk-bootstrap/
cd aws-nitro-enclaves-sdk-bootstrap
git checkout f718dea60a9d9bb8b8682fd852ad793912f3c5db
git apply ../../kernels.patch
nix-build -A all
cd ../
mkdir -p kernels
rsync -av aws-nitro-enclaves-sdk-bootstrap/result/* kernels/
echo "Done"
ls -l kernels