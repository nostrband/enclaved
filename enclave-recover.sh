#!/bin/bash


echo "Recover data from parent"

set -e 

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

# stream file from parent and decrypt and put to /run/disk.img
rclone cat parent:/disk.img.age --config /enclaved/rclone.conf | ./age -d -i age.key -o /run/disk.img 

# info
ls -l /run/disk.img

# shutdown
./supervisord-ctl.sh shutdown

# done
wait $SUPERVISOR_PID
