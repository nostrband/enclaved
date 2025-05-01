# Build layer
FROM eclipse-temurin:21-jre-jammy AS build

# Lock environment for reproducibility
ARG SOURCE_DATE_EPOCH
ENV TZ=UTC
WORKDIR /enclaved

RUN echo "Timestamp" ${SOURCE_DATE_EPOCH}

# docker's package sources 
COPY ./docker-ubuntu.sh .
RUN ./docker-ubuntu.sh && rm ./docker-ubuntu.sh

# nodejs package sources
COPY ./nodesource_setup.sh .
RUN ./nodesource_setup.sh && rm ./nodesource_setup.sh

# install stuff w/ specific versions
RUN DEBIAN_FRONTEND=noninteractive apt-get update
RUN DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    bash=5.1-6ubuntu1.1 \
    wget=1.21.2-2ubuntu1.1 \
    socat=1.7.4.1-3ubuntu4 \
    ipset=7.15-1build1 \
    unzip=6.0-26ubuntu3.2 \
    iptables=1.8.7-1ubuntu5.2 \
    net-tools=1.60+git20181103.0eebece-1ubuntu5 \
    iproute2=5.15.0-1ubuntu2 \
    "docker-ce=5:28.0.4-1~ubuntu.22.04~jammy" \
    "docker-ce-cli=5:28.0.4-1~ubuntu.22.04~jammy" \
    containerd.io=1.7.27-1 \
    rclone=1.53.3-4ubuntu1.22.04.3 \
    xfsprogs=5.13.0-1ubuntu2.1 \
    "conntrack=1:1.4.6-2build2" \
    bridge-utils \
    iputils-ping \
    tcpdump \
    nodejs=23.11.0-1nodesource1

# FIXME remove conntrack and bridge-utils
#RUN apt show conntrack
RUN apt clean 
RUN rm -Rf /var/lib/apt/lists/* /var/log/* /tmp/* /var/tmp/* /var/cache/ldconfig/aux-cache


# phoenix as separate user, it crashes if launched
# as root in our setup
RUN useradd -m phoenix
WORKDIR /home/phoenix
RUN wget https://github.com/ACINQ/phoenixd/releases/download/v0.5.1/phoenixd-0.5.1-linux-x64.zip
RUN sha256sum ./phoenixd-0.5.1-linux-x64.zip | grep 0ad77df5692babfc6d53f72d7aaa6ce27fffce750beea9a4965c4fad6805f0af
RUN unzip -j phoenixd-0.5.1-linux-x64.zip
RUN rm phoenixd-0.5.1-linux-x64.zip phoenix-cli
RUN chown -R phoenix:phoenix *

# other binaries
WORKDIR /enclaved

# dnsproxy
RUN wget https://github.com/AdguardTeam/dnsproxy/releases/download/v0.75.2/dnsproxy-linux-amd64-v0.75.2.tar.gz
RUN sha256sum ./dnsproxy-linux-amd64-v0.75.2.tar.gz | grep 088d3d25c05eabeb840f351afbb12645eeaf34c069a7e60f34bde08e17ed4ea4
RUN mkdir tmp
RUN tar -xvzf ./dnsproxy-linux-amd64-v0.75.2.tar.gz -C tmp
RUN mv ./tmp/linux-amd64/dnsproxy ./
RUN rm -Rf tmp dnsproxy-linux-amd64-v0.75.2.tar.gz

# supervisord
RUN wget https://github.com/ochinchina/supervisord/releases/download/v0.7.3/supervisord_0.7.3_Linux_64-bit.tar.gz
RUN sha256sum ./supervisord_0.7.3_Linux_64-bit.tar.gz | grep f0308bab9c781be06ae59c4588226a5a4b7576ae7e5ea07b9dc86edc0b998de0
RUN tar -xvzf ./supervisord_0.7.3_Linux_64-bit.tar.gz
RUN mv ./supervisord_0.7.3_Linux_64-bit/supervisord ./supervisord
RUN rm -Rf ./supervisord_0.7.3_Linux_64-bit ./supervisord_0.7.3_Linux_64-bit.tar.gz

# vsock utils for networking
COPY ./build/vsock/ip-to-vsock-raw-outgoing .
COPY ./build/vsock/vsock-to-ip-raw-incoming .
COPY ./build/vsock/vsock-to-tun-incoming .

# starter
COPY ./enclave*.sh .
COPY ./supervisord.conf .

# test app - remove later
COPY ./test-app/build/test.tar .
COPY ./test-app/echo-server .
COPY ./busybox.tar .

# enclaved app
# Copy only package-related files first
COPY package.json package-lock.json ./
# Install dependencies 
RUN npm ci --ignore-scripts
# cleanup after npm install etc
RUN rm -Rf /tmp/*

# Copy the rest of the project
COPY src src
COPY tsconfig.json ./

# Mac has different default perms vs Linux
# FIXME what about /home/phoenix?
RUN chown -R root:root *
RUN chmod -R go-w *

# remove files generated on MacOS
RUN rm -Rf /root
RUN mkdir /root

# required by vsock utils
RUN mkdir /app

# result layer to reduce image size and remove differing layers
FROM eclipse-temurin:21-jre-jammy AS server
WORKDIR /

# copy everything
COPY --from=build / /

# Run the server
ENTRYPOINT ["/enclaved/enclave.sh"]
