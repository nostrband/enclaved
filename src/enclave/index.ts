import { startAnnouncing } from "../announce";
import { EnclavedServer, Reply, Request } from "../enclaved";
import { RequestListener } from "../listeners";
import { ParentClient } from "../parent-client";
import { Relay } from "../relay";
import { generateSecretKey, getPublicKey, Event } from "nostr-tools";
import { Signer } from "../types";
import { PrivateKeySigner } from "../signer";
import { launch } from "../compose";
import { DB } from "../db";
import { bytesToHex } from "@noble/hashes/utils";
import { MIN_PORTS_FROM, PORTS_PER_CONTAINER } from "../consts";

// forward NWC calls to wallets
class Server extends EnclavedServer {
  private dir: string;
  private conf: any;
  private db: DB;

  constructor(dir: string, conf: any, signer: Signer) {
    super(signer);
    this.dir = dir;
    this.conf = conf;
    this.db = new DB(dir + "/containers.db");
  }

  public async start() {
    if (this.conf.builtin) {
      console.log("builtin", this.conf.builtin);
      await this.startBuiltin(this.conf.builtin);
    }
  }

  private createContainerFromParams(params: any, isBuiltin: boolean) {
    const key = generateSecretKey();
    const maxPortsFrom = this.db.getMaxPortsFrom();
    const portsFrom = maxPortsFrom
      ? maxPortsFrom + PORTS_PER_CONTAINER
      : MIN_PORTS_FROM;
    return {
      id: 0,
      deployed: false,
      isBuiltin,
      paidUntil: 0,
      portsFrom,
      pubkey: getPublicKey(key),
      seckey: key,
      units: params.units || 1,
      adminPubkey: "",
      docker: params.docker,
      env: params.env ? JSON.stringify(params.env) : undefined,
      name: params.name,
    };
  }

  private async startBuiltin(c: any[]) {
    for (const params of c) {
      console.log("launch builtin", params);
      if (!params.name) throw new Error("Name not specified for builtin");

      let c = this.db.getNamedContainer(params.name);
      if (!c) {
        c = this.createContainerFromParams(params, true);
        console.log("new builtin", params.name, c.pubkey, c.portsFrom);
      } else {
        console.log("existing builtin", params.name, c.pubkey, c.portsFrom);
      }

      await launch({
        ...params,
        dir: this.dir,
        key: c.seckey,
      });

      // mark as deployed
      c.deployed = true;
      this.db.upsertContainer(c);
    }
  }

  protected async launch(req: Request, res: Reply) {
    if (!req.params.docker) throw new Error("Specify docker url");
    throw new Error("Now implemented yet");
    // FIXME check params

    // const key = generateSecretKey();
    // const pubkey = await launch({
    //   ...req.params,
    //   dir: this.dir,
    //   key,
    // });

    // res.result = {
    //   pubkey,
    // };
  }
}

export async function startEnclave(opts: {
  relayUrl: string;
  parentPort: number;
  dir: string;
}) {
  console.log("opts", opts);
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

  const server = new Server(opts.dir, conf, serviceSigner);
  await server.start();

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
