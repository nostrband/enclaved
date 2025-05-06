import { WebSocket, MessageEvent } from "ws";
import { bytesToHex, randomBytes } from "@noble/hashes/utils";
import { verifyBuild, verifyInstance } from "./aws";
import { nsmGetAttestation, nsmParseAttestation } from "./nsm";
import { InstanceInfo } from "./types";

export class ParentClient {
  private port: number;
  private ws?: WebSocket;
  private openPromise?: Promise<void>;
  private pending = new Map<
    string,
    {
      ok: (result: string) => void;
      err: (e: any) => void;
    }
  >();

  constructor(port: number) {
    this.port = port;
    this.connect();
  }

  private connect() {
    this.ws = new WebSocket(`ws://127.0.0.1:${this.port}`);
    this.openPromise = new Promise<void>((ok) => {
      this.ws!.onopen = () => {
        console.log(new Date(), "connected to parent");
        ok();
      };
    });
    this.ws.onclose = () => {
      console.log(new Date(), "disconnected from parent");
      setTimeout(() => this.connect(), 1000);
    };
    this.ws.onmessage = this.onReplyEvent.bind(this);
  }

  private onReplyEvent(e: MessageEvent) {
    const { id, result, error } = JSON.parse(e.data.toString("utf8"));
    console.log("reply", { id, result, error });

    const cbs = this.pending.get(id);
    if (!cbs) return;
    this.pending.delete(id);

    if (error) cbs.err(error);
    else cbs.ok(result);
  }

  private async send(method: string, params: string[], timeout = 10000) {
    // wait until connected
    await this.openPromise!;

    // send request
    const req = {
      id: bytesToHex(randomBytes(6)),
      method,
      params,
    };
    this.ws!.send(JSON.stringify(req));

    // wait reply with timeout
    return new Promise<string>((ok, err) => {
      this.pending.set(req.id, { ok, err });
      setTimeout(() => {
        const cbs = this.pending.get(req.id);
        if (cbs) {
          this.pending.delete(req.id);
          cbs.err("Request timeout");
        }
      }, timeout);
    });
  }

  private async call<T>(method: string, params: string[], timeout = 10000) {
    const r = await this.send(method, params, timeout);
    return JSON.parse(r) as T;
  }

  getIP() {
    return this.call<{ ip: string }>("get_ip", []);
  }

  getConf() {
    return this.call<any>("get_conf", []);
  }

  async getMeta() {
    const att = nsmGetAttestation();
    if (!att) {
      return {};
    }

    const attData = nsmParseAttestation(att);
    const { build, instance, instanceAnnounceRelays, prod } =
      await this.call<InstanceInfo>("get_meta", [att.toString("base64")]);
    if (!build || !instance) throw new Error("Bad reply");

    const notDebug = !!attData.pcrs.get(0)!.find((c) => c !== 0);
    if (notDebug) {
      verifyBuild(attData, build);
      verifyInstance(attData, instance);
    } else {
      if (
        instance.tags.find(
          (t: string[]) => t.length > 1 && t[0] === "PCR4"
        )?.[1] !== bytesToHex(attData.pcrs.get(4)!)
      )
        throw new Error("Invalid instance info from parent");
    }
    console.log(
      new Date(),
      "got valid build and instance info",
      build,
      instance
    );
    return { build, instance, instanceAnnounceRelays, prod };
  }
}
