#!/bin/sh

# Two things with disk:
# 1. We need to backup/recover docker volumes and our main database and files,
# so we create and xfs disk and mount it to /mnt/xfs and add proper links,
# it has small size of 1Gb to make sure it doesn't take too long to backup
# in case AWS signals an imminent reboot.
# 2. We need xfs disk for docker containers to enable disk quotas, this one
# is big and can be recovered from docker hub.

set -e

# 1Gb to recoverable docker volumes
VOLUMES_DISK_SIZE=1024 

if [ -f "/run/disk.img" ] ; then
  echo "disk file already exists"
  # add as device
  losetup -fP /run/disk.img
else 
  # create xfs mount w/ pquota option to be able 
  # to limit per-container storage size
  # more: https://docs.docker.com/reference/cli/docker/container/run/#storage-opt
  dd if=/dev/zero of=/run/disk.img bs=1M count=$VOLUMES_DISK_SIZE

  # add as device and format
  losetup -fP /run/disk.img
  LOOP_DEV=$(losetup -j /run/disk.img | cut -d: -f1)
  mkfs.xfs -f $LOOP_DEV
fi

# mount
mkdir /mnt/xfs
LOOP_DEV=$(losetup -j /run/disk.img | cut -d: -f1)
mount -t xfs -o pquota $LOOP_DEV /mnt/xfs

# docker volumes
mkdir -p /mnt/xfs/volumes
find /mnt/xfs/volumes

# make sure our process uses this disk too
mkdir -p /mnt/xfs/data
ln -s /mnt/xfs/data /enclaved_data

# checks
df
mount | grep /dev/loop
ls -l /mnt/xfs/


# 80% of /run space (which seems to be 50% of total RAM given to enclave) 
# is given to Docker containers, rounded to multiples of 1024,
# minus the space we gave to persistent volumes
DOCKER_DISK_SIZE=`df | grep "/run" | awk '{ print int(int(0.8 * ($2 / 1024 - '"$VOLUMES_DISK_SIZE"')) / 1024) * 1024 }'` 
echo "Docker disk size $DOCKER_DISK_SIZE"

dd if=/dev/zero of=/run/docker.img bs=1M count=$DOCKER_DISK_SIZE

# add as device and format
losetup -fP /run/docker.img
DOCKER_LOOP_DEV=$(losetup -j /run/docker.img | cut -d: -f1)
mkfs.xfs -f $DOCKER_LOOP_DEV

# mount
mkdir /mnt/docker
mount -t xfs -o pquota $DOCKER_LOOP_DEV /mnt/docker

# make sure docker uses xfs
mkdir -p /mnt/docker/docker
ln -s /mnt/docker/docker /var/lib/docker
ln -s /mnt/xfs/volumes /var/lib/docker/volumes

# checks
df
ls -l /mnt/docker
mount | grep /dev/loop
