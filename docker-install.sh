DEBIAN_FRONTEND=noninteractive apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    bash=5.1-6ubuntu1.1 \
    wget=1.21.2-2ubuntu1.1 \
    socat=1.7.4.1-3ubuntu4 \
    ipset=7.15-1build1 \
    unzip=6.0-26ubuntu3.2 \
    iproute2=5.15.0-1ubuntu2 \
    net-tools=1.60+git20181103.0eebece-1ubuntu5 \
    iptables=1.8.7-1ubuntu5.2 \
    "docker-ce=5:28.0.4-1~ubuntu.22.04~jammy" \
    "docker-ce-cli=5:28.0.4-1~ubuntu.22.04~jammy" \
    "docker-compose-plugin=2.35.1-1~ubuntu.22.04~jammy" \
    containerd.io=1.7.27-1 \
    rclone=1.53.3-4ubuntu1.22.04.3 \
    xfsprogs=5.13.0-1ubuntu2.1 \
    nodejs=23.11.0-1nodesource1 \
    "lsof=4.93.2+dfsg-1.1build2" \
    "psmisc=23.4-2build3"

#apt show lsof psmisc
