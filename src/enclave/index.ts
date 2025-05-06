import { startAnnouncing } from "../announce";
import { EnclavedServer, Reply, Request } from "../enclaved";
import { RequestListener } from "../listeners";
import { ParentClient } from "../parent-client";
import { Relay } from "../relay";
import { generateSecretKey, getPublicKey, Event, nip19 } from "nostr-tools";
import { Signer } from "../types";
import { PrivateKeySigner } from "../signer";
import { exec } from "../utils";
import fs from "node:fs";

// forward NWC calls to wallets
class Server extends EnclavedServer {
  private dir: string;
  constructor(dir: string, signer: Signer) {
    super(signer);
    this.dir = dir;
  }

  private async checkImage(image: string) {
    const args = [
      "run",
      "--rm",
      "quay.io/skopeo/stable",
      "inspect",
      `docker://docker.io/${image}`,
    ];

    // format nostrband/nwc-enclaved@sha256:adbf495b2c132e5f0f9a1dc9c20eff51580f9c3127b829d6db7c0fe20f11bbd7
    const { out, err, code } = await exec("docker", args);
    if (code !== 0) throw new Error("Failed to fetch docker image");

    try {
      const info = JSON.parse(out);
      let size = 0;
      for (const d of info.LayersData) {
        size += d.Size;
      }
      console.log(new Date(), "docker", image, "size", size);
      if (size > 300000000) throw new Error("Image too big");
    } catch (e) {
      console.error(new Date(), "Bad docker info", image, out, e);
      throw new Error("Failed to parse image info");
    }
  }

  private async composeUp(params: { path: string; up: boolean; dry: boolean }) {
    await exec("docker-compose", ["--help"]);

    const path = params.path + "/compose.yaml";
    const args = ["-f", path];
    if (params.up) args.push("up");
    else args.push("down");
    if (params.dry) args.push("--dry-run");
    const { code } = await exec("docker-compose", args);
    if (code !== 0) throw new Error("Failed to run docker compose");
  }

  protected async launch(req: Request, res: Reply) {
    if (!req.params.docker) throw new Error("Specify docker url");

    // await this.checkImage(req.params.docker);

    const key = generateSecretKey();
    const pubkey = getPublicKey(key);
    const path = this.dir + "/metadata/" + pubkey;
    fs.mkdirSync(path, { recursive: true });
    fs.writeFileSync(path + "/key.sk", nip19.nsecEncode(key));

    // name: ${nip19.npubEncode(pubkey).substring(0, 10)}
    const compose = `
services:
  main:
    image: ${req.params.docker}
    restart: unless-stopped
    `;
    console.log("compose", compose);
    const composePath = path + "/compose.yaml";
    fs.writeFileSync(composePath, compose);

    await this.composeUp({ path, up: true, dry: false });

    res.result = {
      pubkey,
    };
  }
}

export async function startEnclave(opts: {
  relayUrl: string;
  parentPort: number;
  dir: string;
}) {
  const parent = new ParentClient(opts.parentPort);
  const conf = await parent.getConf();
  console.log("conf", conf);

  const { build, instance, instanceAnnounceRelays, prod } =
    await parent.getMeta();

  console.log(new Date(), "enclaved opts", opts);

  // new admin key on every restart
  const servicePrivkey = generateSecretKey();
  const serviceSigner = new PrivateKeySigner(servicePrivkey);
  const servicePubkey = getPublicKey(servicePrivkey);
  console.log("adminPubkey", servicePubkey);

  const server = new Server(opts.dir, serviceSigner);

  // request handler
  const process = async (e: Event, relay: Relay) => {
    const reply = await server.process(e);
    if (!reply) return; // ignored
    try {
      await relay.publish(reply);
    } catch (err) {
      console.log("failed to publish reply");
      relay.reconnect();
    }
  };

  // main relay + admin listener
  const adminRequestListener = new RequestListener({
    onRequest: async (relay: Relay, pubkey: string, e: Event) => {
      if (pubkey !== servicePubkey) throw new Error("Unknown key");
      await process(e, relay);
    },
  });
  // add admin to request listener, but not perms listener
  adminRequestListener.addPubkey(servicePubkey, [opts.relayUrl]);

  const getStats = async () => {
    const stats = new Map<string, string>();
    // stats.set("pubkeys", ""+keys.size);
    // stats.set("reqs", ""+reqsTotal);
    return stats;
  };

  // announce ourselves
  startAnnouncing({
    build,
    instance,
    privkey: servicePrivkey,
    inboxRelayUrl: opts.relayUrl,
    instanceAnnounceRelays,
    prod,
    getStats,
  });
}

// main
export function mainEnclave(argv: string[]) {
  if (!argv.length) throw new Error("Service not specified");
  switch (argv[0]) {
    case "run":
      const parentPort = Number(argv?.[1]) || 2080;
      const relayUrl = argv?.[2] || "wss://relay.primal.net";
      const dir = argv?.[3] || "/enclaved_data";
      startEnclave({ parentPort, relayUrl, dir });
      break;
  }
}
