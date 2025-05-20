#!/bin/sh

# must run the enclave with --enclave-cid 16
ENCLAVE_CID=16

# stop on errors
set -e

# work dir
cd /enclaved

# some info
pwd
uname -a
cat /etc/*release*
date
free
df
ls -l
ls -l /
ls -l /dev/
ps axuf

# check PRNG, make sure it uses nsm
echo "rng_current:"
RNG=`cat /sys/devices/virtual/misc/hw_random/rng_current`
echo $RNG
if [ "$RNG" != "nsm-hwrng" ]; then
  echo "Bad random number generator"
  exit -1
fi

# set up loopback first
ip addr add 127.0.0.1/8 dev lo
ip link set lo up

# set supervisord password to make sure containers
# can't talk to it FIXME switch to unix socket
PWD=`head /dev/urandom | tr -dc 'A-Za-z0-9' | head -c 12`
sed -i "s/{PASSWORD}/${PWD}/g" supervisord.conf

# check
cat supervisord.conf

# copy data from parent
./enclave-recover.sh

# Run supervisor first, no programs should be running yet
./supervisord -c supervisord.conf &
SUPERVISOR_PID=$!
sleep 1
echo "status"
./supervisord-ctl.sh status

# start proxy to parent
./supervisord-ctl.sh start socat-parent

# setup disk
./enclave-disk-setup.sh 

# setup network (after we started socat and asked parent for our IP)
./enclave-network-setup.sh

# start proxies
./supervisord-ctl.sh start ip-to-vsock-raw-outgoing
./supervisord-ctl.sh start vsock-to-ip-raw-incoming

# start dnsproxy
./supervisord-ctl.sh start dnsproxy

# Start the Docker daemon
./supervisord-ctl.sh start docker

# Wait for Docker daemon to be ready
until docker info >/dev/null 2>&1; do
    echo "[setup.sh] Waiting for Docker daemon..."
    sleep 1
done

# create 'enclaves' network we'll reuse for all containers,
# it will have 172.18.0.0/16 subnet that we've added some rules for
# ignore error if network already exists from recovered disk
docker network create enclaves -o com.docker.network.bridge.name=enclaves || true

# delete default docker rule that we override, looks
# like this can't be done before docker is started
iptables -t nat -D POSTROUTING -s 172.17.0.0/16 ! -o docker0 -j MASQUERADE
iptables -t nat -D POSTROUTING -s 172.18.0.0/16 ! -o enclaves -j MASQUERADE

# print the rules
iptables-save

# skopeo used as docker image,
# needed to check docker image info
# FIXME replace with proper API access
#docker pull quay.io/skopeo/stable:latest #sha256:8bee970d8dbe1260526f18f99709e8323b640c8b7c0cba27da5ccf622cad47cb

# test network
curl -v http://65.109.67.137
curl -v https://google.com

# Finally, start the enclaved process
./supervisord-ctl.sh start enclaved

# tcpdump -i tun0 &


# docker load < busybox.tar
# docker image ls
# docker info
# docker network ls

# try on docker
#docker run -it --rm busybox wget http://nos.lol
# docker-compose -f compose.yaml up -d
# sleep 1


# ifconfig
# iptables-save

# docker-compose -f compose.yaml down

# start phoenixd
#./supervisord ctl -c supervisord.conf start phoenixd

# test networking
#curl -v http://65.109.67.137

# test dns and networking
#curl -v https://google.com


# TEST DOCKER
#docker load < test.tar
#docker load < etest.tar
#docker image ls
#docker info

# try on docker
#docker run --network="host" etest:latest & 
#sleep 2
#docker run 7f8dcc3ae368 

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

#docker load < busybox.tar

# echo "IPTABLES"
# iptables-save
# echo "=================="

# #docker run -it --rm --mount type=bind,src=/etc/sysctl.conf,dst=/etc/sysctl.conf,ro busybox ip route # telnet 3.33.236.230 9735
# iptables -Z FORWARD
# #tcpdump -i docker0 -n -v &
# ls /proc/net/nf_conntrack
# tcpdump -i tun0 -XX &

# echo "nat1"
# iptables -t nat -nvL POSTROUTING
# iptables -t nat -nvL PREROUTING
# echo "mangle1"
# iptables -t mangle -nvL 
# echo "filter1"
# iptables -t filter -nvL OUTPUT
# echo "nfqueue1"
# cat /proc/net/netfilter/nfnetlink_queue
# echo "conntrack1"
# cat /proc/net/nf_conntrack 
# conntrack -E -p tcp &

# sleep 1
# # FIXME add separate policy for each container to avoid
# # port collisions
# # --mount type=bind,src=/etc/sysctl.conf,dst=/etc/sysctl.conf,ro
# #docker run -it --rm busybox wget http://65.109.67.137
# #docker run -it --rm busybox wget https://google.com

# echo "nat2"
# iptables -t nat -nvL POSTROUTING
# iptables -t nat -nvL PREROUTING
# echo "mangle2"
# iptables -t mangle -nvL 
# echo "filter2"
# iptables -t filter -nvL OUTPUT
# echo "nfqueue1"
# cat /proc/net/netfilter/nfnetlink_queue
# echo "conntrack2"
# conntrack -L conntrack 
# echo "conntrack2"
# cat /proc/net/nf_conntrack 

# dmesg | grep iptables
# dmesg | grep conntrack

# cat /proc/net/dev

echo "all started"
wait $SUPERVISOR_PID

echo "shutdown"

# copy data to parent
./enclave-backup.sh