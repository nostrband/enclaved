#!/bin/sh

# 80% of /run space (which seems to be 50% of total RAM given to enclave) 
# is given to Docker containers, rounded to multiples of 1024
DOCKER_DISK_SIZE=`df | grep "/run" | awk '{ print int(int(0.8 * $2 / 1024) / 1024) * 1024 }'` 
echo "Docker disk size $DOCKER_DISK_SIZE"

# create xfs mount w/ pquota option to be able 
# to limit per-container storage size
# more: https://docs.docker.com/reference/cli/docker/container/run/#storage-opt
# ChatGPT created this
dd if=/dev/zero of=/run/disk.img bs=1M count=$DOCKER_DISK_SIZE
losetup -fP /run/disk.img
LOOP_DEV=$(losetup -j /run/disk.img | cut -d: -f1)
# format and mount the disk file
mkfs.xfs -f $LOOP_DEV
mkdir /mnt/xfs
mount -t xfs -o pquota $LOOP_DEV /mnt/xfs

df

# make sure docker uses xfs
mkdir /mnt/xfs/docker
ln -s /mnt/xfs/docker /var/lib/docker