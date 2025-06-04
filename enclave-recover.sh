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

if rclone lsf parent:/ --files-only --config /enclaved/rclone.conf | grep -q '^disk.img.age$'; then
  # testing
  # ./node_modules/.bin/tsx src/index.ts cli set_key 
  # ./node_modules/.bin/tsx src/index.ts cli get_key 

  key=`./node_modules/.bin/tsx src/index.ts cli get_key | tail -n 1`
  echo "age.key from keycrux '$key'";
  echo $key > age.key

  if [[ $key == AGE-SECRET-KEY-* ]] ; then
    echo "Got key from keycrux, recovering...";

    # stream file from parent and decrypt and put to /run/disk.img
    if rclone cat parent:/disk.img.age --config /enclaved/rclone.conf | ./age -d -i age.key -o /run/disk.img ; then
      # info
      ls -l /run/disk.img
    else
      echo "Failed to recover disk file"
    fi
  else 
    echo "Error: no key on keycrux"
    exit 1
  fi

else
  echo "No disk file, starting from scratch"
  ./age-keygen -o age.key
fi

# shutdown
./supervisord-ctl.sh shutdown
