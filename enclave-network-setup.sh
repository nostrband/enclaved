#!/bin/sh

# switch to legacy command syntax
update-alternatives --set iptables /usr/sbin/iptables-legacy
update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy

# query ip of instance and store
ip=172.31.41.69

# required by vsock-to-ip-raw-incoming
echo $ip > /app/ip.txt
#/app/vet --url vsock://3:1300/instance/ip > /app/ip.txt
#cat /app/ip.txt && echo

# set up loopback
ip addr add 127.0.0.1/8 dev lo
ip link set lo up

# set up bridge
ip link add name br0 type bridge
ip addr add $ip/32 dev br0
ip link set dev br0 mtu 9001
ip link set dev br0 up

# adding a default route via the bridge
ip route add default dev br0 src $ip

# localhost dns
echo "127.0.0.1 localhost" > /etc/hosts

ip link
ip addr
ip route
cat /etc/hosts

# set ephemeral port range
cat > /etc/sysctl.conf <<EOF
# this port range is mapped from the enclave to the parent
# and can be used to connect to the internet
net.ipv4.ip_local_port_range=1024 61439
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

# iptables rules to route traffic to a nfqueue to be picked up by the proxy
iptables -A OUTPUT -p tcp -s $ip -m set --match-set portfilter src -m set ! --match-set internal dst -j NFQUEUE --queue-num 0
iptables -t nat -vL
iptables -S

echo "done enclave-network-setup.sh"