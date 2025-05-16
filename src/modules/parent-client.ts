import { bytesToHex } from "@noble/hashes/utils";
import { verifyBuild, verifyInstance } from "./aws";
import { nsmGetAttestation, nsmParseAttestation } from "./nsm";
import { InstanceInfo } from "./types";
import { WSClient } from "./ws-client";

export class ParentClient extends WSClient {
  private onShutdown?: () => void;

  constructor(opts: { port: number; onShutdown?: () => void }) {
    super(`ws://127.0.0.1:${opts.port}`);
    this.onShutdown = opts.onShutdown;
  }

  protected onEvent(event: { type: string }): void {
    if (event.type === "shutdown") {
      this.onShutdown?.();
    }
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

    const notDebug = !!attData.pcrs.get(0)!.find((c) => c !== 0);
    if (notDebug) {
      if (!build || !instance) throw new Error("Bad reply");
      if (process.env.DEBUG === "true")
        throw new Error("Non-debug instance with DEBUG=true");
      verifyBuild(attData, build);
      verifyInstance(attData, instance);
    } else {
      if (process.env.DEBUG !== "true")
        throw new Error("Debug instance with DEBUG != true");
      if (
        instance &&
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
