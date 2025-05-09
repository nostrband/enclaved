import { RawData, WebSocket, WebSocketServer } from "ws";
import fs from "node:fs";
import { validateEvent, verifyEvent } from "nostr-tools";
import { nsmParseAttestation } from "../nsm";
import { verifyBuild, verifyInstance } from "../aws";
import { fetchOutboxRelays } from "../cli/utils";
import { getIP } from "../utils";

interface Rep {
  id: string;
  result: string;
  error?: string;
}

class ParentServer {
  private wss: WebSocketServer;
  private dir: string;
  private ws?: WebSocket;

  constructor({ port, dir = "./instance/" }: { port: number; dir?: string }) {
    this.dir = dir;
    this.wss = new WebSocketServer({ port });
    this.wss.on("connection", this.onConnect.bind(this));

    setInterval(this.checkShutdown.bind(this), 1000);
  }

  private checkShutdown() {
    if (!this.ws) return;
    const file = this.dir + "/shutdown";
    if (!fs.existsSync(file)) return;
    fs.rmSync(file);
    this.ws.send(JSON.stringify({ event: { type: "shutdown" } }));
  }

  private read() {
    let build = undefined;
    let instance = undefined;
    try {
      build = JSON.parse(
        fs.readFileSync(this.dir + "/build.json").toString("utf8")
      );
    } catch (e) {
      console.log("No build file", e);
    }
    try {
      instance = JSON.parse(
        fs.readFileSync(this.dir + "/instance.json").toString("utf8")
      );
    } catch (e) {
      console.log("No instance file", e);
    }
    console.log("build", build);
    console.log("instance", instance);
    if (build) {
      if (!validateEvent(build) || !verifyEvent(build))
        throw new Error("Invalid build.json");
    }
    if (instance) {
      if (!validateEvent(instance) || !verifyEvent(instance))
        throw new Error("Invalid build.json");
    }

    return { build, instance };
  }

  private onConnect(ws: WebSocket, req: any) {
    console.log("connect", req.headers);
    // FIXME check header token

    this.ws = ws;
    ws.on("error", console.error);
    ws.on("close", () => (this.ws = undefined));
    ws.on("message", this.onMessage.bind(this));
  }

  private async getMeta(params: string[]) {
    const att = Buffer.from(params[0], "base64");
    console.log("start att", att);

    const attData = nsmParseAttestation(att);

    const { build, instance } = this.read();
    // debug enclaves return zero PCR0
    const prodEnclave = !!attData.pcrs.get(0)!.find((c) => c !== 0);
    if (prodEnclave) {
      verifyBuild(attData, build);
      verifyInstance(attData, instance);
    }

    const pubkeys = [];
    if (build) pubkeys.push(build.pubkey);
    if (instance) pubkeys.push(instance.pubkey);
    const relays = pubkeys.length
      ? await fetchOutboxRelays(pubkeys)
      : ["wss://relay.damus.io", "wss://relay.primal.net"];
    console.log("outbox relays", build?.pubkey, instance?.pubkey, relays);

    const prod = process.env.PROD === "true";
    return JSON.stringify({
      build: build,
      instance: instance,
      instanceAnnounceRelays: relays,
      prod,
    });
  }

  private async getIP() {
    const ip = getIP();
    if (!ip) throw new Error("Failed to get IP");
    return JSON.stringify({
      ip,
    });
  }

  private async getConf() {
    const conf = JSON.parse(fs.readFileSync("enclaved.conf").toString("utf8"));
    if (!conf) throw new Error("Failed to get conf");
    return JSON.stringify({
      ...conf,
    });
  }

  private async onMessage(data: RawData) {
    console.log("received: %s", data);
    let rep: Rep | undefined;
    try {
      const req = JSON.parse(data.toString("utf8"));
      console.log("req", req);
      rep = {
        id: req.id,
        result: "",
      };
      switch (req.method) {
        case "get_ip":
          rep.result = await this.getIP();
          break;
        case "get_conf":
          rep.result = await this.getConf();
          break;
        case "get_meta":
          rep.result = await this.getMeta(req.params);
          break;
        default:
          throw new Error("Unknown method");
      }
    } catch (e: any) {
      console.log("Bad req", e, data.toString("utf8"));
      if (rep) rep.error = e.message || e.toString();
    }
    console.log("rep", rep);

    // closed by now?
    if (!this.ws) return;

    if (rep) {
      this.ws.send(JSON.stringify(rep));
    } else {
      this.ws.close();
    }
  }
}

function startParentServer(port: number) {
  new ParentServer({ port });
}

export function mainParent(argv: string[]) {
  if (!argv.length) throw new Error("Service not specified");
  if (argv[0] === "run") {
    const parentPort = Number(argv?.[1]) || 1080;
    startParentServer(parentPort);
  }
}
