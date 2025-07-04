#!/bin/bash


echo "Recover data from parent"

set -e 

./supervisord-ctl.sh start socat-rclone

# rclone config for backup
cat > /enclaved/rclone.conf <<EOF
[parent]
type = webdav
url = http://127.0.0.1:3080
EOF

# FIXME rclone server might cache the disk file and if we're debugging and deleted it,
# this code might still think the file is there and won't start
if rclone lsf parent:/ --files-only --config /enclaved/rclone.conf | grep -q '^disk.img.age$'; then
  echo "Disk file backup found"
  # testing
  # ./node_modules/.bin/tsx src/index.ts cli set_key 
  # ./node_modules/.bin/tsx src/index.ts cli get_key 

  key=`./node_modules/.bin/tsx src/index.ts cli get_key | tail -n 1`
  echo "age.key from keycrux '$key'";
  echo $key > age.key

  if [[ $key == AGE-SECRET-KEY-* ]] ; then

    # log age pubkey
    pubkey=`./age-keygen -y age.key`
    ./node_modules/.bin/tsx src/index.ts cli log "Age pubkey $pubkey"

    echo "Got key from keycrux, recovering...";

    # stream file from parent and decrypt and put to /run/disk.img
    if rclone cat parent:/disk.img.age --config /enclaved/rclone.conf | ./age -d -i age.key -o /run/disk.img ; then
      # info
      ls -l /run/disk.img
      ./node_modules/.bin/tsx src/index.ts cli log "Disk file recovered"
    else
      echo "Failed to recover disk file"
      ./node_modules/.bin/tsx src/index.ts cli log "Error: Failed to recover disk file"
      exit 1
    fi
  else 
    echo "Error: no key on keycrux"
    ./node_modules/.bin/tsx src/index.ts cli log "Error: No key in keycrux"
    exit 1
  fi

else
  echo "No disk file, starting from scratch"
  ./node_modules/.bin/tsx src/index.ts cli log "Creating new disk file"
  ./age-keygen -o age.key

  pubkey=`./age-keygen -y age.key`
  ./node_modules/.bin/tsx src/index.ts cli log "Age pubkey $pubkey"
fi

# shutdown
./supervisord-ctl.sh shutdown
