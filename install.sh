#!/bin/bash

# from https://docs.aws.amazon.com/enclaves/latest/user/nitro-enclave-cli-install.html

sudo dnf install aws-nitro-enclaves-cli -y
sudo dnf install aws-nitro-enclaves-cli-devel -y
sudo dnf install socat -y
sudo usermod -aG ne ec2-user
sudo usermod -aG docker ec2-user

# leave 2 CPU for parent
ENCLAVE_CPUS=`cat /proc/cpuinfo  | grep processor | wc | awk '{print $1-2}'`
# 50% of memory to enclave, can't have more bcs it requires all memory
# to be on the same "node" 
ENCLAVE_RAM=`free | grep Mem  | awk '{print (int($2 / 1024 / 1024) + 1) / 2 * 1024}'`
cat > allocator.yaml <<EOF
---
# Enclave configuration file.
#
# How much memory to allocate for enclaves (in MiB).
memory_mib: $ENCLAVE_RAM
#
# How many CPUs to reserve for enclaves.
cpu_count: $ENCLAVE_CPUS
EOF

sudo mv allocator.yaml /etc/nitro_enclaves/allocator.yaml

sudo systemctl enable --now nitro-enclaves-allocator.service
sudo systemctl enable --now docker

# supervisord
wget https://github.com/ochinchina/supervisord/releases/download/v0.7.3/supervisord_0.7.3_Linux_64-bit.tar.gz
sha256sum ./supervisord_0.7.3_Linux_64-bit.tar.gz | grep f0308bab9c781be06ae59c4588226a5a4b7576ae7e5ea07b9dc86edc0b998de0
tar -xvzf ./supervisord_0.7.3_Linux_64-bit.tar.gz
mv ./supervisord_0.7.3_Linux_64-bit/supervisord ./build/supervisord
rm -Rf ./supervisord_0.7.3_Linux_64-bit ./supervisord_0.7.3_Linux_64-bit.tar.gz
