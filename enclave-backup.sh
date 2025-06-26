#!/bin/bash


echo "Backup data to parent"

echo "Synching disk..."
sync
echo "Synched"

sleep 1

# symlinks
rm /var/lib/docker
rm /enclaved_data

# ls -l /
# ls -l /mnt/xfs/
# df
# lsof +D /mnt/xfs
# fuser -vm /mnt/xfs
# mount | grep /dev/loop
# ps axuf

find /mnt/xfs

# hmm
umount /mnt/docker

# unmount
while ! umount /mnt/xfs ; do
  echo "Waiting for /mnt/xfs to be unmounted..."
  lsof +D /mnt/xfs
  fuser -vm /mnt/xfs
  sleep 1
done

set -e 

# remove device
losetup -d $(losetup -j /run/disk.img | cut -d: -f1)

# start socat
./supervisord -c supervisord.conf &
SUPERVISOR_PID=$!

sleep 1

./supervisord-ctl.sh status

./supervisord-ctl.sh start socat-rclone

# rclone config for backup
cat > /enclaved/rclone.conf <<EOF
[parent]
type = webdav
url = http://127.0.0.1:3080
EOF

# disk encryption key
PUBKEY=`./age-keygen -y age.key`
echo $PUBKEY 

# encrypt and stream to the parent
./age -r $PUBKEY /run/disk.img | rclone rcat parent:/disk.img.age --config /enclaved/rclone.conf

# shutdown
./supervisord-ctl.sh shutdown

# done
wait $SUPERVISOR_PID
