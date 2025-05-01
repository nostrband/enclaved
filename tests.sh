

# parent CID = 3
./ip-to-vsock-raw-outgoing --vsock-addr 3:1080 --queue-num 0 &
./vsock-to-ip-raw-incoming --vsock-addr $ENCLAVE_CID:1080 --device tun0 &

sleep 5

#./e./phoenixd-0.5.1-linux-x64/phoenixd --http-bind-port=740cho-server &
#curl -v localhost:3000

#curl -v 65.109.67.137

#curl -v https://google.com

dockerd &  # --iptables=false &
sleep 5

ifconfig
iptables -S

docker load < test.tar
#docker load < etest.tar
docker image ls
docker info

# try on docker
#docker run --network="host" etest:latest & 
#sleep 2
docker run -p 3000:3000 test:latest & #--network="host" 

sleep 2

echo "enclave => docker"
curl -v localhost:3000

./dnsproxy/linux-amd64/dnsproxy -u https://1.1.1.1/dns-query &

sleep 3

curl -v https://google.com

# FIXME move this to Dockerfile
cp ./phoenixd /home/phoenix/
cp ./phoenix-cli /home/phoenix/

# wallet state sync for debugging 
RCLONE_PORT=2022
socat TCP4-LISTEN:${RCLONE_PORT},reuseaddr,fork,forever,keepalive VSOCK-CONNECT:3:${RCLONE_PORT} &
mkdir -p /home/phoenix/.config/rclone
mkdir /home/phoenix/.phoenix
cat > /home/phoenix/.config/rclone/rclone.conf << EOF
[phoenix]
type = webdav
url = http://127.0.0.1:${RCLONE_PORT}

EOF
cat /home/phoenix/.config/rclone/rclone.conf

# ensure perms
chown -R phoenix:phoenix /home/phoenix
ls -la /home/phoenix
# allows mounting as phoenix but doesn't actually set proper owner
#chmod go+rw /dev/fuse
#ls -l /dev/fuse
# run rclone
rclone mount phoenix:/ /home/phoenix/.phoenix --vfs-cache-mode writes --config /home/phoenix/.config/rclone/rclone.conf  &
# wait until mount starts before reading/writing
sleep 5
mkdir /home/phoenix/.phoenix/dir
chown phoenix:phoenix /home/phoenix/.phoenix/dir
#chown -R phoenix:phoenix /home/phoenix/.phoenix
ls -la /home/phoenix/
ls -la /home/phoenix/.phoenix
echo "TEST" > /home/phoenix/.phoenix/b
ls -la /home/phoenix/.phoenix

# testing
#runuser -u phoenix -- ls -l /home/phoenix/.phoenix
#runuser -u phoenix -- echo "TEST" > /home/phoenix/.phoenix/a

sleep 10
exit

# phoenix daemon
runuser -u phoenix -- /home/phoenix/phoenixd --verbose --agree-to-terms-of-service --http-bind-ip 0.0.0.0 &

sleep 3

runuser -u phoenix -- /home/phoenix/phoenix-cli getinfo

runuser -u phoenix -- /home/phoenix/phoenix-cli createinvoice --amountSat=100 --description test 

sleep 200

runuser -u phoenix -- /home/phoenix/phoenix-cli payinvoice --invoice=lnbc500n1pnlvvaepp5c95n94hva9r88eqxdwx4c7vhgcm74vtpndayk7yjvl0dtypmp38qdqqcqzzsxqyz5vqsp5d7p6vp0eja5mxwzn5092rfcaha60fumn4v0lzh86szxagsg4hu0s9qxpqysgq9y64vyrg9xgjkk02zssreszuuyukqcaymg8xah3pxge0gn6dk3eh7zn5qkqd3lffth828x405fl6dmkck5lejvukld0g0v9mjyp8qyqqel7ala

# start dnsproxy
#/app/supervisord ctl -c /etc/supervisord.conf start dnsproxy

# generate identity key
#/app/keygen-x25519 --secret /app/id.sec --public /app/id.pub
#/app/keygen-secp256k1 --secret /app/ecdsa.sec --public /app/ecdsa.pub

# start attestation servers
#/app/supervisord ctl -c /etc/supervisord.conf start attestation-server
#/app/supervisord ctl -c /etc/supervisord.conf start attestation-server-ecdsa

# Start the Docker daemon
#/app/supervisord ctl -c /etc/supervisord.conf start docker

# Wait for Docker daemon to be ready
#until docker info >/dev/null 2>&1; do
#    echo "[setup.sh] Waiting for Docker daemon..."
#    sleep 1
#done

# start docker compose
#/app/supervisord ctl -c /etc/supervisord.conf start compose

#wait $SUPERVISOR_PID