#!/bin/sh

set -e

# switch to legacy command syntax
update-alternatives --set iptables /usr/sbin/iptables-legacy
update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy

ip=`./node_modules/.bin/tsx src/index.ts cli parent_get_ip | tail -n 1`

# take IP from parent
echo "IP $ip"

# required by vsock utils
echo $ip > ip.txt
grep $ip ip.txt

# add TUN device to proxy through vsock,
# TUN instead of bridge required so that we could
# pass incoming packets through network stack
# to make reverse-NAT work
ip tuntap add dev tun0 mode tun
ip addr add $ip/32 dev tun0
ip link set dev tun0 mtu 9001
ip link set dev tun0 up

# adding a default route via the bridge
ip route add default dev tun0 src $ip

# localhost dns
echo "127.0.0.1 localhost" > /etc/hosts
rm /etc/resolv.conf # remove link to /run/resolvconf/resolv.conf
echo "nameserver $ip" > /etc/resolv.conf
mkdir -p /etc/docker
echo "{ \"dns\":[\"$ip\"] }" > /etc/docker/daemon.json

ip link
ip addr
ip route
cat /etc/hosts
cat /etc/resolv.conf
cat /etc/docker/daemon.json

# set ephemeral port range
cat > /etc/sysctl.conf <<EOF
# 1024:61439 is the port range mapped from enclave 
# to the parent and the internet, 
# we limit host's range to these ports and then give
# each container their own range to make sure they all
# don't collide due to our rudimentary NAT
net.ipv4.ip_local_port_range=1024 4999
# we need this for forwarding traffic from docker containers
net.ipv4.ip_forward=1
# enable conntrack logging
net.netfilter.nf_conntrack_log_invalid=1
# disable rp_filter
net.ipv4.conf.tun0.rp_filter=0
net.ipv4.conf.all.rp_filter=0
# disable ipv6 - we don't support it yet
net.ipv6.conf.all.disable_ipv6 = 1
net.ipv6.conf.default.disable_ipv6 = 1
net.ipv6.conf.lo.disable_ipv6 = 1
EOF

# apply the above changes
sysctl -p /etc/sysctl.conf

# create ipset with all "internal" (unroutable) addresses
ipset create internal hash:net
ipset add internal 0.0.0.0/8
ipset add internal 10.0.0.0/8
ipset add internal 100.64.0.0/10
ipset add internal 127.0.0.0/8
ipset add internal 169.254.0.0/16
ipset add internal 172.16.0.0/12
ipset add internal 192.0.0.0/24
ipset add internal 192.0.2.0/24
ipset add internal 192.88.99.0/24
ipset add internal 192.168.0.0/16
ipset add internal 198.18.0.0/15
ipset add internal 198.51.100.0/24
ipset add internal 203.0.113.0/24
ipset add internal 224.0.0.0/4
ipset add internal 233.252.0.0/24
ipset add internal 240.0.0.0/4
ipset add internal 255.255.255.255/32

# create ipset with the ports supported for routing
ipset create portfilter bitmap:port range 0-65535
ipset add portfilter 1024-61439
ipset add portfilter 80
ipset add portfilter 443

# iptables rules to route traffic from host to a NFQUEUE to be picked up by the proxy
iptables -A OUTPUT -p tcp -s $ip -m set --match-set portfilter src -m set ! --match-set internal dst -j NFQUEUE --queue-num 0

# forward traffic from docker containers
# =======
# first we set the mark for outgoing packets from docker,
# FIXME
iptables -t mangle -A FORWARD -s 172.17.0.0/16 ! -o docker0 -j MARK --set-mark 1
iptables -t mangle -A FORWARD -s 172.17.0.0/16 ! -o docker0 -j CONNMARK --save-mark
iptables -t mangle -A FORWARD -s 172.18.0.0/16 ! -o enclaves -j MARK --set-mark 1
iptables -t mangle -A FORWARD -s 172.18.0.0/16 ! -o enclaves -j CONNMARK --save-mark
# then we NAT them and change source IP to $ip and conntrack them,
# delete default docker rule and set our own rule using simpler SNAT and limiting 
# source ports from docker to make sure they don't collide with host's ports
# because our vsock proxy overwrites source IP but can't overwrite the source port
# NOTE: docker deletion will happen after docker is started in enclave.sh
#iptables -t nat -D POSTROUTING -s 172.17.0.0/16 ! -o docker0 -j MASQUERADE
iptables -t nat -A POSTROUTING -s 172.17.0.0/16 ! -o docker0 -p tcp -j SNAT --to-source $ip:5000-61439
iptables -t nat -A POSTROUTING -s 172.18.0.0/16 ! -o enclaves -p tcp -j SNAT --to-source $ip:5000-61439
# since we can't forward to NFQUEUE after POSTROUTING
# we have to loop these packets back to kernel
# for second pass of rule matching
ip rule add fwmark 1 table 100
ip route add default dev tun0 table 100
# then we catch them before routing and restore the mark and send to NFQUEUE
# making sure to avoid catching incoming reply packets with the mark using ! -d $ip 
iptables -t mangle -A PREROUTING ! -d $ip -j CONNMARK --restore-mark
iptables -t mangle -A PREROUTING ! -d $ip -m mark --mark 1 -j NFQUEUE --queue-num 0 
# =======

#iptables -L FORWARD -v -n --line-numbers
#iptables -L nat -v -n --line-numbers
#iptables -S

echo "done enclave-network-setup.sh"