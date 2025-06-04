import { WebSocket } from "ws";
import fs from "node:fs";
import { validateEvent, verifyEvent, Event } from "nostr-tools";
import { nsmParseAttestation } from "../modules/nsm";
import { verifyBuild, verifyInstance, verifyRelease } from "../modules/aws";
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
    let build: Event | undefined;
    let instance: Event | undefined;
    let releases: Event[] = [];
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
    try {
      const files = fs.readdirSync(this.dir + "/release/");
      console.log("release files", files);
      for (const file of files) {
        const release = JSON.parse(
          fs.readFileSync(this.dir + "/release/" + file).toString("utf8")
        );
        releases.push(release);
      }
    } catch (e) {
      console.log("No release files", e);
    }
    console.log("build", build);
    console.log("instance", instance);
    console.log("releases", releases);
    if (build) {
      if (!validateEvent(build) || !verifyEvent(build))
        throw new Error("Invalid build.json");
    }
    if (instance) {
      if (!validateEvent(instance) || !verifyEvent(instance))
        throw new Error("Invalid instance.json");
    }
    if (releases) {
      for (const release of releases)
        if (!validateEvent(release) || !verifyEvent(release))
          throw new Error("Invalid releases");
    }

    return { build, instance, releases };
  }

  protected onConnected(ws: WebSocket) {
    this.ws = ws;
    ws.on("close", () => (this.ws = undefined));
  }

  private async getMeta(params: string[]) {
    const att = Buffer.from(params[0], "base64");
    console.log("start att", att);

    const attData = nsmParseAttestation(att);

    const { build, instance, releases } = this.read();
    // debug enclaves return zero PCR0
    const prodEnclave = !!attData.pcrs.get(0)!.find((c) => c !== 0);
    if (prodEnclave) {
      verifyBuild(attData, build!);
      verifyInstance(attData, instance!);
      for (const release of releases)
        verifyRelease(attData, release);
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
      releases,
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
