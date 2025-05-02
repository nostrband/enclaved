#!/bin/sh

# must run the enclave with --enclave-cid 16
ENCLAVE_CID=16

# stop on errors
set -e

# work dir
cd /enclaved

# some info for debugging
# pwd
# free
# df
# ls -l
# ls -l /

# disk
./enclave-disk-setup.sh 

# setup network
./enclave-network-setup.sh

# required by vsock utils
#mkdir -p /nix/store/maxa3xhmxggrc5v2vc0c3pjb79hjlkp9-glibc-2.40-66/lib/
#ln -s /lib64/ld-linux-x86-64.so.2 /nix/store/maxa3xhmxggrc5v2vc0c3pjb79hjlkp9-glibc-2.40-66/lib/ld-linux-x86-64.so.2
mkdir -p /nix/store/p9kdj55g5l39nbrxpjyz5wc1m0s7rzsx-glibc-2.40-66/lib/
ln -s /lib64/ld-linux-x86-64.so.2 /nix/store/p9kdj55g5l39nbrxpjyz5wc1m0s7rzsx-glibc-2.40-66/lib/ld-linux-x86-64.so.2

# Run supervisor first, no programs should be running yet
cat supervisord.conf
./supervisord -c supervisord.conf &
SUPERVISOR_PID=$!
sleep 1
echo "status"
./supervisord ctl -c supervisord.conf status

# start proxies
./supervisord ctl -c supervisord.conf start ip-to-vsock-raw-outgoing
./supervisord ctl -c supervisord.conf start vsock-to-ip-raw-incoming

# start dnsproxy
./supervisord ctl -c supervisord.conf start dnsproxy

# Start the Docker daemon
./supervisord ctl -c supervisord.conf start docker

# Wait for Docker daemon to be ready
until docker info >/dev/null 2>&1; do
    echo "[setup.sh] Waiting for Docker daemon..."
    sleep 1
done

# delete default docker rule that we'll override
iptables -t nat -D POSTROUTING -s 172.17.0.0/16 ! -o docker0 -j MASQUERADE

# start docker compose
#/app/supervisord ctl -c /etc/supervisord.conf start compose


# start phoenixd
#./supervisord ctl -c supervisord.conf start phoenixd

# test networking
curl -v http://65.109.67.137

# test dns and networking
curl -v https://google.com


# TEST DOCKER
#docker load < test.tar
#docker load < etest.tar
#docker image ls
#docker info

# try on docker
#docker run --network="host" etest:latest & 
#sleep 2
#docker run -p 3000:3000 test:latest &

#sleep 2

#echo "enclave => docker"
#curl -v localhost:3000

#ip link set docker0 up
#ip link show docker0
#brctl show
#ip route
#ip addr 
#ip -4 addr show docker0
#ip -4 addr show tun0
#ip route show

#./echo-server &

#docker pull nostrband/nwc-enclaved@sha256:adbf495b2c132e5f0f9a1dc9c20eff51580f9c3127b829d6db7c0fe20f11bbd7
#docker image ls
# bind /etc/sysctl.conf to make sure our settings of ephemeral ports are copied to the container
#docker run -it --rm --mount type=bind,src=/etc/sysctl.conf,dst=/etc/sysctl.conf,ro nostrband/nwc-enclaved@sha256:adbf495b2c132e5f0f9a1dc9c20eff51580f9c3127b829d6db7c0fe20f11bbd7

#set +e

docker load < busybox.tar

echo "IPTABLES"
iptables-save
echo "=================="

#docker run -it --rm --mount type=bind,src=/etc/sysctl.conf,dst=/etc/sysctl.conf,ro busybox ip route # telnet 3.33.236.230 9735
iptables -Z FORWARD
#tcpdump -i docker0 -n -v &
ls /proc/net/nf_conntrack
tcpdump -i tun0 -XX &

echo "nat1"
iptables -t nat -nvL POSTROUTING
iptables -t nat -nvL PREROUTING
echo "mangle1"
iptables -t mangle -nvL 
echo "filter1"
iptables -t filter -nvL OUTPUT
echo "nfqueue1"
cat /proc/net/netfilter/nfnetlink_queue
echo "conntrack1"
cat /proc/net/nf_conntrack 
conntrack -E -p tcp &

sleep 1
# FIXME add separate policy for each container to avoid
# port collisions
# --mount type=bind,src=/etc/sysctl.conf,dst=/etc/sysctl.conf,ro
docker run -it --rm busybox wget http://65.109.67.137
#docker run -it --rm busybox wget https://google.com

echo "nat2"
iptables -t nat -nvL POSTROUTING
iptables -t nat -nvL PREROUTING
echo "mangle2"
iptables -t mangle -nvL 
echo "filter2"
iptables -t filter -nvL OUTPUT
echo "nfqueue1"
cat /proc/net/netfilter/nfnetlink_queue
echo "conntrack2"
conntrack -L conntrack 
echo "conntrack2"
cat /proc/net/nf_conntrack 

dmesg | grep iptables
dmesg | grep conntrack

cat /proc/net/dev

echo "all done"
wait $SUPERVISOR_PID




