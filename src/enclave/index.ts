import { startAnnouncing } from "../announce";
import { EnclavedServer, Reply, Request } from "../enclaved";
import { RequestListener } from "../listeners";
import { ParentClient } from "../parent-client";
import { Relay } from "../relay";
import { generateSecretKey, getPublicKey, Event } from "nostr-tools";
import { Signer } from "../types";
import { PrivateKeySigner } from "../signer";
import { DB } from "../db";
import { MIN_PORTS_FROM, PORTS_PER_CONTAINER } from "../consts";
import { exec } from "../utils";
import { Container, ContainerContext } from "./container";
import { publishNip65Relays } from "../nostr";

// forward NWC calls to wallets
class Server extends EnclavedServer {
  private context: ContainerContext;
  private conf: any;
  private db: DB;
  private conts: Container[] = [];

  constructor(context: ContainerContext, conf: any) {
    super(context.serviceSigner);
    this.conf = conf;
    this.context = context;
    this.db = new DB(context.dir + "/containers.db");
  }

  public async start() {
    if (this.conf.builtin) {
      console.log("builtin", this.conf.builtin);
      await this.startBuiltin(this.conf.builtin);
    }
  }

  public containerCount() {
    return this.conts.length;
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

  private async startBuiltin(builtins: any[]) {
    for (const params of builtins) {
      console.log("launch builtin", params);
      if (!params.name) throw new Error("Name not specified for builtin");

      let info = this.db.getNamedContainer(params.name);
      if (!info) {
        info = this.createContainerFromParams(params, true);
        console.log("new builtin", params.name, info.pubkey, info.portsFrom);
      } else {
        console.log(
          "existing builtin",
          params.name,
          info.pubkey,
          info.portsFrom
        );
      }

      const cont = new Container(info, this.context);

      await cont.launch();

      // mark as deployed
      cont.setDeployed(true);
      this.db.upsertContainer(cont.info);

      this.conts.push(cont);
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

  public async shutdown() {
    for (const c of this.conts) {
      console.log("shutdown", c.info.pubkey);
      await c.stop();
    }
  }
}

export async function startEnclave(opts: {
  relayUrl: string;
  parentPort: number;
  dir: string;
}) {
  console.log("opts", opts);
  let server: Server | undefined;
  let shutdown = false;

  const parent = new ParentClient({
    port: opts.parentPort,
    onShutdown: async () => {
      console.log(new Date(), "shutdown");
      shutdown = true;
      await server?.shutdown();
      exec("./supervisord-ctl.sh", ["shutdown"]);
    },
  });
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

  // was shutdown while we were starting?
  if (shutdown) return;

  // server
  server = new Server(
    { dir: opts.dir, prod: !!prod, serviceSigner, relays: [opts.relayUrl] },
    conf
  );
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
  publishNip65Relays(serviceSigner, instanceAnnounceRelays);

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
      const relayUrl = argv?.[2] || "wss://relay.primal.net";
      const dir = argv?.[3] || "/enclaved_data";
      startEnclave({ parentPort, relayUrl, dir });
      break;
  }
}
