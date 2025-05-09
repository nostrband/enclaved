#!/bin/sh

set -e

if [ -f "/run/disk.img" ] ; then
  echo "disk file already exists"
  # add as device
  losetup -fP /run/disk.img
else 
  # 80% of /run space (which seems to be 50% of total RAM given to enclave) 
  # is given to Docker containers, rounded to multiples of 1024
  DOCKER_DISK_SIZE=`df | grep "/run" | awk '{ print int(int(0.8 * $2 / 1024) / 1024) * 1024 }'` 
  echo "Docker disk size $DOCKER_DISK_SIZE"

  # create xfs mount w/ pquota option to be able 
  # to limit per-container storage size
  # more: https://docs.docker.com/reference/cli/docker/container/run/#storage-opt
  # ChatGPT created this
  dd if=/dev/zero of=/run/disk.img bs=1M count=$DOCKER_DISK_SIZE

  # add as device and format
  losetup -fP /run/disk.img
  LOOP_DEV=$(losetup -j /run/disk.img | cut -d: -f1)
  mkfs.xfs -f $LOOP_DEV
fi

# mount
mkdir /mnt/xfs
LOOP_DEV=$(losetup -j /run/disk.img | cut -d: -f1)
mount -t xfs -o pquota $LOOP_DEV /mnt/xfs

df

# make sure docker uses xfs
mkdir -p /mnt/xfs/docker
ln -s /mnt/xfs/docker /var/lib/docker

# make sure our process uses this disk too
mkdir -p /mnt/xfs/data
ln -s /mnt/xfs/data /enclaved_data

mount | grep /dev/loop

ls -l /mnt/xfs/
