#!/bin/sh

# switch to legacy command syntax
update-alternatives --set iptables /usr/sbin/iptables-legacy
update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy

# FIXME take IP from parent
# query ip of instance and store
ip=172.31.43.219
echo "IP $ip"

# required by vsock-to-ip-raw-incoming
echo $ip > /app/ip.txt
#/app/vet --url vsock://3:1300/instance/ip > /app/ip.txt
#cat /app/ip.txt && echo

# set up loopback
ip addr add 127.0.0.1/8 dev lo
ip link set lo up

# set up bridge for routing host traffic
#ip link add name br0 type bridge
#ip addr add $ip/32 dev br0
#ip link set dev br0 mtu 9001
#ip link set dev br0 up

# adding a default route via the bridge
#ip route add default dev br0 src $ip

# add TUN device for incoming traffic for docker 
ip tuntap add dev br0 mode tun
ip addr add $ip/32 dev br0
ip link set dev br0 mtu 9001
ip link set dev br0 up

# adding a default route via the bridge
ip route add default dev br0 src $ip
# OR???
#ip route add default via $ip dev tun0

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
# this port range is mapped from the enclave to the parent
# and can be used to connect to the internet
net.ipv4.ip_local_port_range=1024 61439
# we need this for forwarding traffic from docker containers
net.ipv4.ip_forward=1
EOF

# apply the above changes
sysctl -p /etc/sysctl.conf

echo "net.ipv4.ip_forward"
sysctl -n net.ipv4.ip_forward

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

# iptables rules to route traffic from host to a nfqueue to be picked up by the proxy
iptables -A OUTPUT -p tcp -s $ip -m set --match-set portfilter src -m set ! --match-set internal dst -j NFQUEUE --queue-num 0

# forward traffic from docker containers
# =======
# MASQUERADE for outbound NAT from docker subnet to $ip
iptables -t nat -A POSTROUTING -s 172.17.0.0/16 -o br0 -j MASQUERADE
# forward after NAT to NFQUEUE (we can't add NFQUEUE to -t nat rule)
iptables -t mangle -A POSTROUTING -s 172.17.0.0/16 -j NFQUEUE --queue-num 0

# Allow conntrack-based return from br0 to Docker
iptables -A FORWARD -i br0 -o docker0 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT

# Forward new traffic from br0 to Docker
#iptables -A FORWARD -i br0 -o docker0 -d 172.17.0.0/16 -j ACCEPT

# Accept packets to host IP on br0
#iptables -A INPUT -i br0 -d $ip -j ACCEPT
#iptables -A INPUT -i br0 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
#iptables -A FORWARD -i br0 -o docker0 -j LOG --log-prefix "BR0->DOCKER DROP: "


# Allow container → outside (br0)
#iptables -A FORWARD -i docker0 -o br0 -s 172.17.0.0/16 -j ACCEPT
# Allow return traffic (tracked)
#iptables -A FORWARD -i br0 -o docker0 -d 172.17.0.0/16 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
# Fallback: allow direct return
#iptables -A FORWARD -i br0 -o docker0 -d 172.17.0.0/16 -j ACCEPT
# A rule if conntrack is broken
#iptables -I FORWARD -i br0 -d 172.17.0.0/16 -j ACCEPT
# NFQUEUE rule for filtering container outbound traffic
#iptables -A FORWARD -p tcp -s 172.17.0.0/16 -m set --match-set portfilter src -m set ! --match-set internal dst -j NFQUEUE --queue-num 0
# =======

iptables -L FORWARD -v -n --line-numbers
iptables -t nat -vL
iptables -S

echo "done enclave-network-setup.sh"