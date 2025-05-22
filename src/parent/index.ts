import { WebSocket } from "ws";
import fs from "node:fs";
import { validateEvent, verifyEvent } from "nostr-tools";
import { nsmParseAttestation } from "../modules/nsm";
import { verifyBuild, verifyInstance } from "../modules/aws";
import { fetchOutboxRelays } from "../cli/utils";
import { getIP } from "../modules/utils";
import { WSServer, Rep, Req } from "../modules/ws-server";
import { DEFAULT_RELAYS } from "../modules/nostr";

// FIXME
class ParentServer extends WSServer {
  private dir: string;
  private ws?: WebSocket;

  constructor({ port, dir = "./instance/" }: { port: number; dir?: string }) {
    super(port);
    this.dir = dir;

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

  protected onConnected(ws: WebSocket) {
    this.ws = ws;
    ws.on("close", () => (this.ws = undefined));
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
      : DEFAULT_RELAYS;
    console.log("outbox relays", build?.pubkey, instance?.pubkey, relays);

    const prod = process.env.PROD === "true";
    return {
      build: build,
      instance: instance,
      instanceAnnounceRelays: relays,
      prod,
    };
  }

  private async getIP() {
    const ip = getIP();
    if (!ip) throw new Error("Failed to get IP");
    return {
      ip,
    };
  }

  protected async handle(req: Req, rep: Rep) {
    try {
      switch (req.method) {
        case "get_ip":
          rep.result = await this.getIP();
          break;
        case "get_meta":
          rep.result = await this.getMeta(req.params);
          break;
        default:
          throw new Error("Unknown method");
      }
    } catch (e: any) {
      console.log("Bad req", e, req);
      if (rep) rep.error = e.message || e.toString();
    }
    console.log("rep", rep);
  }
}

function startParentServer(port: number) {
  new ParentServer({ port });
}

export function mainParent(argv: string[]) {
  if (!argv.length) throw new Error("Service not specified");
  if (argv[0] === "run") {
    const parentPort = Number(argv?.[1]) || 2080;
    startParentServer(parentPort);
  }
}
