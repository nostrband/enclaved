import { startAnnouncing } from "../announce";
import { EnclavedServer, Reply, Request } from "../enclaved";
import { RequestListener } from "../listeners";
import { ParentClient } from "../parent-client";
import { Relay } from "../relay";
import { generateSecretKey, getPublicKey, Event } from "nostr-tools";
import { PrivateKeySigner } from "../signer";
import { DB, DBContainer } from "../db";
import { MIN_PORTS_FROM, PORTS_PER_CONTAINER } from "../consts";
import { exec, getIP } from "../utils";
import { Container, ContainerContext } from "./container";
import {
  prepareAppCert,
  prepareContainerCert,
  prepareRootCertificate,
  publishNip65Relays,
} from "../nostr";
import fs from "node:fs";
import { bytesToHex, randomBytes } from "@noble/hashes/utils";
import { WSServer, Rep, Req } from "../ws-server";
import { nsmGetAttestationInfo } from "../nsm";
import { IncomingHttpHeaders } from "http";
import { WebSocket } from "ws";

export function getSecretKey(dir: string) {
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
    console.log("existing containers:");
    this.db
      .listContainers()
      .map((c) =>
        console.log(
          "p",
          c.pubkey,
          "name",
          c.name,
          "builtin",
          c.isBuiltin,
          "docker",
          c.docker
        )
      );
  }

  public getContext(): ContainerContext {
    return this.context;
  }

  public getContainers(): Container[] {
    return this.conts;
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

  private createContainerFromParams(
    params: any,
    isBuiltin: boolean
  ): DBContainer {
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
      token: bytesToHex(randomBytes(16)),
      units: params.units || 1,
      adminPubkey: "",
      docker: params.docker,
      env: params.env,
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
        // might have changed
        info.docker = params.docker;
        info.env = params.env;
        info.units = params.units;
      }

      const cont = new Container(info, this.context);
      await cont.up();

      // mark as deployed
      cont.setDeployed(true);
      this.db.upsertContainer(cont.info);

      this.conts.push(cont);

      // start printing it's logs
      cont.printLogs(true);
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
      await c.down();
    }
  }
}

class ContainerServer extends WSServer {
  private server: Server;

  constructor(port: number, server: Server) {
    super(port);
    this.server = server;
  }

  private getContainer(headers?: IncomingHttpHeaders) {
    const token = headers?.["token"];
    return this.server.getContainers().find((c) => c.info.token === token);
  }

  protected checkHeaders(ws: WebSocket, headers: IncomingHttpHeaders) {
    return !!this.getContainer(headers);
  }

  private async createCertificate(
    req: Req,
    rep: Rep,
    headers?: IncomingHttpHeaders
  ) {
    if (!req.params.pubkey) throw new Error("No pubkey for certificate");
    const pubkey = req.params.pubkey;

    const info = nsmGetAttestationInfo(
      await this.server.getContext().serviceSigner.getPublicKey(),
      this.server.getContext().prod
    );
    const root = await prepareRootCertificate(
      info,
      this.server.getContext().serviceSigner
    );

    const cont = this.getContainer(headers);
    const contCert = await prepareContainerCert({
      info: cont!.info,
      serviceSigner: this.server.getContext().serviceSigner,
    });

    const appCert = await prepareAppCert({
      info: cont!.info,
      appPubkey: pubkey,
    });

    rep.result = {
      root,
      certs: [contCert, appCert],
    };
  }

  protected async handle(req: Req, rep: Rep, headers?: IncomingHttpHeaders) {
    if (req.method === "create_certificate") {
      await this.createCertificate(req, rep, headers);
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
  const servicePrivkey = getSecretKey(opts.dir);
  const serviceSigner = new PrivateKeySigner(servicePrivkey);
  const servicePubkey = getPublicKey(servicePrivkey);
  console.log("adminPubkey", servicePubkey);

  // was shutdown while we were starting?
  if (shutdown) return;

  // server
  const contPort = opts.parentPort + 1;
  const ip = getIP("tun0");

  server = new Server(
    {
      dir: opts.dir,
      prod: !!prod,
      serviceSigner,
      contEndpoint: `ws://${ip}:${contPort}`,
      relays: [opts.relayUrl],
    },
    conf
  );
  await server.start();

  // handle requests from containers
  new ContainerServer(contPort, server);

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
      const relayUrl = argv?.[2] || "wss://relay.damus.io";
      const dir = argv?.[3] || "/enclaved_data";
      startEnclave({ parentPort, relayUrl, dir });
      break;
  }
}
