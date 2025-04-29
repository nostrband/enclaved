import { startAnnouncing } from "../announce";
import { EnclavedServer } from "../enclaved";
import { RequestListener } from "../listeners";
import { ParentClient } from "../parent-client";
import { Relay } from "../relay";
import { generateSecretKey, getPublicKey, Event } from "nostr-tools"
import { Signer } from "../types";
import { PrivateKeySigner } from "../signer";


// forward NWC calls to wallets
class Server extends EnclavedServer {
  constructor(signer: Signer) {
    super(signer);
  }
}

export async function startEnclave(opts: {
  relayUrl: string;
  parentPort: number;
}) {
  const parent = new ParentClient(opts.parentPort)
  const { build, instance, instanceAnnounceRelays, prod } = await parent.start();

  console.log(new Date(), "enclaved opts", opts);

  // new admin key on every restart
  const servicePrivkey = generateSecretKey();
  const serviceSigner = new PrivateKeySigner(servicePrivkey);
  const servicePubkey = getPublicKey(servicePrivkey);
  console.log("adminPubkey", servicePubkey);

  const server = new Server(serviceSigner);

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
  if (argv[0] === "run") {
    const parentPort = Number(argv?.[1]) || 1080;
    const relayUrl = argv?.[2] || "wss://relay.primal.net";
    startEnclave({ parentPort, relayUrl });
  }
}
