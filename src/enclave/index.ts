import { startAnnouncing } from "../modules/announce";
import { RequestListener } from "../modules/listeners";
import { ParentClient } from "../modules/parent-client";
import { Relay } from "../modules/relay";
import { generateSecretKey, getPublicKey, Event } from "nostr-tools";
import { PrivateKeySigner } from "../modules/signer";
import { CONF_FILE } from "../modules/consts";
import { exec, getIP } from "../modules/utils";
import fs from "node:fs";
import { bytesToHex } from "@noble/hashes/utils";
import { AppServer } from "./app-server";
import { ContainerServer } from "./container-server";
import { ContainerContext } from "./container";

function getSecretKey(dir: string) {
  const FILE = dir + "/.service.sk";
  if (fs.existsSync(FILE)) {
    const hex = fs.readFileSync(FILE).toString("utf8");
    const privkey = Buffer.from(hex, "hex");
    if (privkey.length !== 32) throw new Error("Invalid privkey");
    console.log("existing service key");
    return privkey;
  }

  console.log("new service key");
  const privkey = generateSecretKey();
  fs.writeFileSync(FILE, bytesToHex(privkey));
  return privkey;
}

function getConf() {
  const conf = JSON.parse(fs.readFileSync(CONF_FILE).toString("utf8"));
  if (!conf) throw new Error("Failed to get conf");
  return {
    ...conf,
  };
}

export async function startEnclave(opts: {
  relayUrl: string;
  parentPort: number;
  dir: string;
}) {
  console.log("opts", opts);
  let server: AppServer | undefined;
  let shutdown = false;

  const conf = getConf();
  console.log("conf", conf);

  // keep connection to receive shutdown events
  const parent = new ParentClient({
    port: opts.parentPort,
    onShutdown: async () => {
      console.log(new Date(), "shutdown");
      shutdown = true;
      try {
        // if it fails we should proceed to shutting down
        // in hope to save the state
        await server?.shutdown();
      } catch (e) {
        console.error("Failed to shutdown the app server gracefully", e);
      }
      exec("./supervisord-ctl.sh", ["shutdown"]);
    },
  });

  // get meta info from parent
  const { build, instance, instanceAnnounceRelays, prod } =
    await parent.getMeta();

  console.log(new Date(), "enclaved opts", opts);

  const servicePrivkey = getSecretKey(opts.dir);
  const serviceSigner = new PrivateKeySigner(servicePrivkey);
  const servicePubkey = getPublicKey(servicePrivkey);
  console.log("adminPubkey", servicePubkey);

  // was shutdown while we were starting?
  if (shutdown) return;

  // server
  const contPort = opts.parentPort + 1;
  const device = process.env["ENCLAVED_NETWORK_DEVICE"] || "tun0";
  const ip = getIP(device);
  if (!ip) throw new Error("No IP on device " + device);

  const context: ContainerContext = {
    dir: opts.dir,
    prod: !!prod,
    serviceSigner,
    contEndpoint: `ws://${ip}:${contPort}`,
    relays: [opts.relayUrl],
    instanceAnnounceRelays,
  };

  // init the server
  server = new AppServer(context, conf);

  // handle requests from containers
  new ContainerServer(contPort, server);

  // start
  await server.start();

  // request handler
  const handler = async (e: Event, relay: Relay) => {
    const reply = await server!.process(e);
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
      await handler(e, relay);
    },
  });
  // add admin to request listener, but not perms listener
  adminRequestListener.addPubkey(servicePubkey, [opts.relayUrl]);

  const getStats = async () => {
    const stats = new Map<string, string>();
    stats.set("containers", "" + server!.containerCount());
    // stats.set("reqs", ""+reqsTotal);
    return stats;
  };

  // announce ourselves
  startAnnouncing({
    build,
    instance,
    signer: serviceSigner,
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
      const relayUrl = argv?.[2] || "wss://relay.enclaved.org";
      const dir = argv?.[3] || "/enclaved_data";
      startEnclave({ parentPort, relayUrl, dir });
      break;
  }
}
