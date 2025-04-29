#!/bin/sh

# must run the enclave with --enclave-cid 16
ENCLAVE_CID=16

# stop on errors
set -e

# some info for debugging
cd /enclaved
pwd
free
df
ls -l
ls -l /

# disk
./enclave-disk-setup.sh

# network
./enclave-network-setup.sh

# required by vsock utils
mkdir -p /nix/store/maxa3xhmxggrc5v2vc0c3pjb79hjlkp9-glibc-2.40-66/lib/
ln -s /lib64/ld-linux-x86-64.so.2 /nix/store/maxa3xhmxggrc5v2vc0c3pjb79hjlkp9-glibc-2.40-66/lib/ld-linux-x86-64.so.2

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

sleep 2

# Start the Docker daemon
./supervisord ctl -c supervisord.conf start docker

# Wait for Docker daemon to be ready
until docker info >/dev/null 2>&1; do
    echo "[setup.sh] Waiting for Docker daemon..."
    sleep 1
done

# start docker compose
#/app/supervisord ctl -c /etc/supervisord.conf start compose


# start phoenixd
#./supervisord ctl -c supervisord.conf start phoenixd

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

#docker pull nostrband/nwc-enclaved@sha256:adbf495b2c132e5f0f9a1dc9c20eff51580f9c3127b829d6db7c0fe20f11bbd7
#docker image ls
#docker run -it --rm nostrband/nwc-enclaved@sha256:adbf495b2c132e5f0f9a1dc9c20eff51580f9c3127b829d6db7c0fe20f11bbd7

docker pull busybox
docker run -it --rm busybox wget https://google.com #telnet 3.33.236.230 9735

wait $SUPERVISOR_PID




