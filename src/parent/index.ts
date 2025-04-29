import { RawData, WebSocket, WebSocketServer } from "ws";
import fs from "node:fs";
import { networkInterfaces } from "os";
import { validateEvent, verifyEvent } from "nostr-tools";
import { nsmParseAttestation } from "../nsm";
import { verifyBuild, verifyInstance } from "../aws";
import { fetchOutboxRelays } from "../cli/utils";

interface Rep {
  id: string;
  result: string;
  error?: string;
}

class ParentServer {
  private wss: WebSocketServer;
  private dir: string;

  constructor({ port, dir = "./instance/" }: { port: number; dir?: string }) {
    this.dir = dir;
    this.wss = new WebSocketServer({ port });
    this.wss.on("connection", this.onConnect.bind(this));
  }

  private read() {
    const build = JSON.parse(
      fs.readFileSync(this.dir + "/build.json").toString("utf8")
    );
    const instance = JSON.parse(
      fs.readFileSync(this.dir + "/instance.json").toString("utf8")
    );
    console.log("build", build);
    console.log("instance", instance);
    if (!validateEvent(build) || !verifyEvent(build))
      throw new Error("Invalid build.json");
    if (!validateEvent(instance) || !verifyEvent(instance))
      throw new Error("Invalid build.json");

    return { build, instance };
  }

  private onConnect(ws: WebSocket) {
    ws.on("error", console.error);
    const self = this;
    ws.on("message", (data) => self.onMessage(ws, data));
  }

  private async handleStart(params: string[]) {
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

    const relays = await fetchOutboxRelays([build.pubkey, instance.pubkey]);
    console.log("outbox relays", build.pubkey, instance.pubkey, relays);

    const prod = process.env.PROD === "true";
    return JSON.stringify({
      build: build,
      instance: instance,
      instanceAnnounceRelays: relays,
      prod,
    });
  }

  private getIP() {
    const nets: any = networkInterfaces();
    console.log("nets", nets);
    for (const name of Object.keys(nets)) {
      if (!name.startsWith("ens")) continue;
      for (const net of nets[name]) {
        // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
        // 'IPv4' is in Node <= 17, from 18 it's a number 4 or 6
        const familyV4Value = typeof net.family === "string" ? "IPv4" : 4;
        if (net.family === familyV4Value && !net.internal) {
          return net.address;
        }
      }
    }
    return undefined;
  }

  private async handleIP() {
    const ip = this.getIP();
    if (!ip) throw new Error("Failed to get IP");
    return JSON.stringify({
      ip,
    });
  }

  private async onMessage(ws: WebSocket, data: RawData) {
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
        case "ip":
          rep.result = await this.handleIP();
          break;
        case "start":
          rep.result = await this.handleStart(req.params);
          break;
        default:
          throw new Error("Unknown method");
      }
    } catch (e: any) {
      console.log("Bad req", e, data.toString("utf8"));
      if (rep) rep.error = e.message || e.toString();
    }
    console.log("rep", rep);
    if (rep) {
      ws.send(JSON.stringify(rep));
    } else {
      ws.close();
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
