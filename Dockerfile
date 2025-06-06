# Build layer
FROM ubuntu:jammy-20240627.1@sha256:340d9b015b194dc6e2a13938944e0d016e57b9679963fdeb9ce021daac430221 AS build

# Lock environment for reproducibility
ARG SOURCE_DATE_EPOCH
ENV TZ=UTC
WORKDIR /enclaved

RUN echo "Timestamp" ${SOURCE_DATE_EPOCH}

# docker's package sources 
COPY ./docker-ubuntu.sh .
RUN ./docker-ubuntu.sh && rm ./docker-ubuntu.sh

# main install - docker, socat, ip stuff, node, rclone, xfs, etc
COPY ./docker-install.sh .
RUN ./docker-install.sh && rm ./docker-install.sh

RUN apt clean 
RUN rm -Rf /var/lib/apt/lists/* /var/log/* /tmp/* /var/tmp/* /var/cache/ldconfig/aux-cache

# nodejs
RUN wget https://nodejs.org/dist/v24.0.1/node-v24.0.1-linux-x64.tar.xz
RUN sha256sum node-v24.0.1-linux-x64.tar.xz | grep 12d8b7c7dd9191bd4f3afe872c7d4908ac75d2a6ef06d2ae59c0b4aa384bc875
RUN tar -xJf node-v24.0.1-linux-x64.tar.xz -C /usr/local --strip-components=1 && rm node-v24.0.1-linux-x64.tar.xz

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

# age
RUN wget https://github.com/FiloSottile/age/releases/download/v1.2.1/age-v1.2.1-linux-amd64.tar.gz
RUN sha256sum age-v1.2.1-linux-amd64.tar.gz | grep 7df45a6cc87d4da11cc03a539a7470c15b1041ab2b396af088fe9990f7c79d50
RUN tar -xvzf age-v1.2.1-linux-amd64.tar.gz --strip-components=1 age/age
RUN tar -xvzf age-v1.2.1-linux-amd64.tar.gz --strip-components=1 age/age-keygen
RUN rm -Rf age-v1.2.1-linux-amd64.tar.gz

# vsock utils for networking
COPY ./build/vsock/ip-to-vsock-raw-outgoing .
COPY ./build/vsock/vsock-to-ip-raw-incoming .

# conf
COPY ./enclaved.json .
COPY ./release.json .

# starter
COPY ./enclave*.sh .
COPY ./supervisord.conf .
COPY ./supervisord-ctl.sh .

# test app - remove later
#COPY ./test-app/build/test.tar .
#COPY ./test-app/echo-server .
#COPY ./busybox.tar .
#COPY ./compose.yaml .
#COPY ./nwc-enclaved.tar .

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
RUN chown -R root:root *
RUN chmod -R go-w *

# remove files generated on MacOS
RUN rm -Rf /root
RUN mkdir /root

# required by vsock utils
RUN mkdir -p /nix/store/p9kdj55g5l39nbrxpjyz5wc1m0s7rzsx-glibc-2.40-66/lib/
RUN ln -s /lib64/ld-linux-x86-64.so.2 /nix/store/p9kdj55g5l39nbrxpjyz5wc1m0s7rzsx-glibc-2.40-66/lib/ld-linux-x86-64.so.2

# result layer to reduce image size and remove differing layers
FROM ubuntu:jammy-20240627.1@sha256:340d9b015b194dc6e2a13938944e0d016e57b9679963fdeb9ce021daac430221 AS server
WORKDIR /

# copy everything
COPY --from=build / /

# Run the server
ENTRYPOINT ["/enclaved/enclave.sh"]
