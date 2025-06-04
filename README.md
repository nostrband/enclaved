# Enclaved: application server for TEE

`enclaved` (*Enclave Daemon*) - allows you to deploy docker images on [AWS Nitro Enclaves](https://aws.amazon.com/ec2/nitro/nitro-enclaves/), with ability to discover the running containers on Nostr and pay for them with Bitcoin over Lightning Network.

AWS Nitro Enclave is a trusted execution environment (TEE) that allows clients to cryptographically verify the code running on the server, which improves privacy and security guarantees.

## Why TEE?

Modern servers are **black boxes**, violating your privacy, selling your data or getting hacked. 

Many people choose to self-host important services, but that's complex and expensive. Running services on mobile devices is unreliable and quite restrictive. Use of transparent "smart contracts" is only applicable to a narrow range of problems.

TEEs might come as a solution. 

Within TEE any reproducible code is a **white box** - you know the hash of specific code image running in the TEE, and can verify it matches your expectations.

This might open doors to serious privacy and security improvements.

So we set out to build an application server to make deploying apps in TEE as simple as running a docker container.

We also love Bitcoin and Nostr, so we're making `enclaved` discoverable on Nostr, and payable with Bitcoin.

Should be fun, right?!

## Architecture

AWS Nitro Enclaves are kind of like a virtual machine launched inside an EC2 server instance. Some CPUs and RAM are reserved for the enclave, and AWS Nitro hypervisor isolates it from the parent. The enclave doesn't have network or persistent storage. The only interface is `/dev/vsock` allowing comms with the parent instance. The only disk space is RAM allocated to the enclave. If the enclave is restarted, the state is gone.

To launch an enclave, you need to build a docker image. The image must be reproducible, otherwise the attestation of it doesn't make much sense. To check our build process, look at [`build-docker.sh`](https://github.com/nostrband/enclaved/blob/main/build-docker.sh) and the [`Dockerfile`](https://github.com/nostrband/enclaved/blob/main/Dockerfile). The image is saved at `./build/enclaved.tar` with image hashes placed at `./build/docker.json`.

After the docker image is built, we need to convert it into `eif` (Enclave Image Format) that's used for AWS Nitro Enclaves. That's done with `nitro-cli` utility provided by AWS, which basically adds it's own Linux kernel to the docker image, and allows us to add digital signature to the image, see [`build-enclave-signed.sh`](https://github.com/nostrband/enclaved/blob/main/build-enclave-signed.sh). Built image is saved at `./build/enclaved.eif` and the [`PCR values`](https://docs.aws.amazon.com/enclaves/latest/user/set-up-attestation.html) of the image at `./build/pcrs.json`. This `eif` image can then be launched by `nitro-cli` in an enclave.

To host general-purpose applications inside the enclave we at least need to add networking. The basic idea is to proxy all the traffic from the enclave through `/dev/vsock` to the parent and from there to the internet and back. We took the work of [Marlin Protocol](https://github.com/marlinprotocol) team as the basis - their set of [`raw-proxies`](https://github.com/marlinprotocol/oyster-monorepo/tree/master/networking/raw-proxy) capture IP packets using NFQUEUE, route them through `vsock`, and then inject incoming packets back using RAW sockets. But then we added docker...

`enclaved` uses docker for app deployment - it provides isolation, and allows us to restrict the amount of resources (CPU/RAM/disk) that each container is using. Docker creates local sub-networks for containers, and uses `iptables` to NAT traffic to the internet. We had to modify the `raw-proxy` utilities, `iptables` rules and change the Linux kernel config of `nitro-cli` to make NATed traffic work accross `vsock`. Check [`vsock_proxy`](https://github.com/nostrband/enclaved/tree/main/vsock_proxy) for modified proxies, [`enclave-network-setup.sh`](https://github.com/nostrband/enclaved/blob/main/enclave-network-setup.sh) for iptables, and [`kernels.patch`](https://github.com/nostrband/enclaved/blob/main/kernels.patch) for kernel config changes.

We use [`dnsproxy`](https://github.com/AdguardTeam/dnsproxy) to do DNS resolution over TCP, as UDP proxying over `vsock` is not implemented.

Obviously, `vsock` interface on the parent side needs proxying too. Plus, parent provides other services to the enclave, like the parent's IP address to enable networking on the enclave, and others. Check [`launch-parent.sh`](https://github.com/nostrband/enclaved/blob/main/launch-parent.sh) for the list of settings and services on the parent. 

The entrypoint inside the enclave is [`enclave.sh`](https://github.com/nostrband/enclaved/blob/main/enclave.sh). It fetches the instance IP address from the parent over `vsock`, sets up the network and disk, and launches the enclave main process.

Disk setup is at [`enclave-disk-setup.sh`](https://github.com/nostrband/enclaved/blob/main/enclave-disk-setup.sh) - we allocate a big file, attach it as a disk device, format with `xfs` to enable space usage restrictions, and mount it at `/mnt/xfs`. The docker's work dir (`/var/lib/docker/`) is placed on that disk, along with other to-be-persisted data of the app server.

We use [`supervisord`](https://github.com/ochinchina/supervisord) to manage processes on the parent and inside the enclave, configs are at [`supervisord.conf`](https://github.com/nostrband/enclaved/blob/main/supervisord.conf) and [`supervisord-parent.conf`](https://github.com/nostrband/enclaved/blob/main/supervisord-parent.conf). It makes sure utilities like proxies, docker and the app server itself are always running.

App server is supposed to be autonomous and to accept Bitcoin payments directly from clients. We use our own [`nwc-enclaved`](https://github.com/nostrband/nwc-enclaved`) custodial Lightning wallet embedded into the `enclaved` server. Check the [`enclaved.json`](https://github.com/nostrband/enclaved/blob/main/enclaved.json) config file that instructs the app server to pull specific `nwc-enclaved` docker image and launch it as a built-in app to provide the billing capability.

The `enclaved` server advertises itself on the Nostr network when launched to enable discovery, you can read more about the mechanics on our adjacent project's [`README`](https://github.com/nostrband/noauth-enclaved/blob/main/README.md#launching-the-instance) and explore some launched instances on [enclaved.org](https://enclaved.org).

## Disk persistence

Even if there were no plans to upgrade the code, we might occasionally need to restart the enclave, so there must be a way to backup and recover the data from the enclave. 

The approach recommended by AWS is to use AWS Key Management Service to store a private key that would be used by the enclave to encrypt it's data and send it to parent. On restart, enclave would request the keys back from KMS (which would check if PCR values are the same, etc) and then recover and decrypt the data.

We are skeptical about the use of AWS KMS, so we'll *"build it ourselves"* (tm). Right now, when parent sends `shutdown` command, the enclave's `supervisord` is gracefully stopped, disk file is unmounted and then stream-encrypted with [`age`](https://github.com/FiloSottile/age) and sent back to parent with [`rclone`](https://rclone.org), `socat` and `vsock`. The data is saved in `./instance/data/`, and when the enclave is restarted, same data is read back from parent and decrypted by `age` and mounted back as disk. 

To decrypt the data recovered on restart, we upload the encryption key into a key storage service. The key storage is [`keycrux`](https://github.com/nostrband/keycrux), it's a simple service running in it's own TEE. `enclaved` will upload it's disk key into `keycrux` and provide it's current attestation. When `enclaved` restarts, it asks `keycrux` for the keys and provides it's new attestation - if attestations are exactly the same (simple restart) then keys are returned, and `enclaved` can decrypt it's state. 

## Code updates

If code is upgraded and attestation changes, how can previous `enclaved` state be recovered?

If clients rely on specific code hashes to verify the server, how can server be updated? It's easy when you control your own client and can update them both, but it's not ok when clients are third-parties. 

That's where our custom key store (`keycrux`) will help. 

To recover the state if `enclaved` is upgraded, an *update policy* is provided when disk key is uploaded to `keycrux`. Later on, when key is requested, if newly provided attestation differs from the one provided when key was stored, `keycrux` verifies the new attestation against the policy. Currently, the policy is roughly "the new build is signed by the same pubkeys", which means "if maintainers decided to upgrade the code, then it's ok to release the keys". 

For clients, instead of relying on specific [PCR values](https://docs.aws.amazon.com/enclaves/latest/user/set-up-attestation.html#where), we're proposing a similar approach: rely on a set of maintainers signing new code releases. When client discovers a service with unknown PCR values, it should check the set of `release signatures` - if those are made by the expected set of maintainers, then it is assumed that the service is valid.

FIXME link to NIP-style proposals for all these Nostr events.

## Exposing open ports

This is TBD, we plan to use [Caddy](https://caddyserver.com/) inside the enclave to provide E2EE TLS encryption, network stack should work, but more research is needed on how to handle DNS, etc.

## Client interface

This is TBD, the plan is to have HTTP API, Nostr RPC API and control over Nostr notes/DMs, ala *"@enclave-instance deploy docker/image..."*. You get a quote and invoice, and the image is deployed if paid. Each container has a zap-able Nostr profile, so you or someone else could topup the balance by zapping or sending sats using hundreds of LN wallets and Nostr apps. Container app might even topup it's own balance itself if it's earning sats... *AI agents, AI agents everywhere!*

## Contribution

This is prototype, if you're interested in helping shape it - send suggestions and PRs.


