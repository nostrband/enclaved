if [ $(id -u) -ne 0 ]
  then echo Please run this script as root or using sudo!
  exit
fi

ip=`runuser -l ec2-user -- -c "cd /home/ec2-user/enclaved; ./node_modules/.bin/tsx src/index.ts cli get_ip | awk '{print $2}'"`
echo "ip" $ip

# run enclaves with --enclave-cid 16
ENCLAVE_CID=16

if [ -z "$ip" ]; then
	echo "ERROR: Provide local ip!"
	exit -1
fi

# set ephemeral port range
sudo cat > /etc/sysctl.conf <<EOF
# this port range is not mapped to the enclave
# and can be used by parent to connect to the internet
net.ipv4.ip_local_port_range=61440 65535
EOF

# apply the above changes
sudo sysctl -p /etc/sysctl.conf

# iptables rules to route traffic to a nfqueue to be picked up by the proxy
iptables -P INPUT ACCEPT
iptables -A INPUT -i ens5 -p tcp --dport 1024:61439 -j NFQUEUE --queue-num 0 #  -m set --match-set portfilter dst -m set ! --match-set internal src -j NFQUEUE --queue-num 0
iptables -S

# sudo killall vsock-to-ip-raw-outgoing
# sudo killall ip-to-vsock-raw-incoming
# sleep 1
# sudo ./build/vsock/vsock-to-ip-raw-outgoing --vsock-addr 3:1080 >/dev/null 2>&1 &
# sudo ./build/vsock/ip-to-vsock-raw-incoming --vsock-addr $ENCLAVE_CID:1080 --queue-num 0 >/dev/null 2>&1 &

# Run supervisor
cat supervisord.conf

# shutdown first
./build/supervisord ctl -c supervisord-parent.conf status
./build/supervisord ctl -c supervisord-parent.conf shutdown

# relaunch
./build/supervisord -c supervisord-parent.conf &
SUPERVISOR_PID=$!
sleep 1
echo "status"
./build/supervisord ctl -c supervisord-parent.conf status

# start proxies
./build/supervisord ctl -c supervisord-parent.conf start vsock-to-ip-raw-outgoing
./build/supervisord ctl -c supervisord-parent.conf start ip-to-vsock-raw-incoming

# start socat
./build/supervisord ctl -c supervisord-parent.conf start socat

# start parent
./build/supervisord ctl -c supervisord-parent.conf start parent

wait $SUPERVISOR_PID