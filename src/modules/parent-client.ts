import { bytesToHex } from "@noble/hashes/utils";
import { verifyBuild, verifyInstance, verifyRelease } from "./aws";
import { nsmGetAttestation, nsmParseAttestation } from "./nsm";
import { InstanceInfo } from "./types";
import { WSClient } from "./ws-client";
import fs from "node:fs";

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

  log(s: string) {
    return this.call<void>("log", [s]);
  }

  getIP() {
    return this.call<{ ip: string }>("get_ip", []);
  }

  getConf() {
    return this.call<any>("get_conf", []);
  }

  async getMeta(): Promise<InstanceInfo> {
    const att = nsmGetAttestation();
    if (!att) {
      return {};
    }

    const releasePolicy = JSON.parse(
      fs.readFileSync("release.json").toString("utf8")
    );
    if (!releasePolicy.signer_pubkeys || !releasePolicy.signer_pubkeys.length)
      throw new Error("No signer pubkeys");

    const attData = nsmParseAttestation(att);
    const { build, instance, releases, instanceAnnounceRelays, prod } =
      await this.call<InstanceInfo>("get_meta", [att.toString("base64")]);

    const notDebug = !!attData.pcrs.get(0)!.find((c) => c !== 0);
    if (notDebug) {
      if (!build || !instance || !releases) throw new Error("Bad reply");
      if (process.env.DEBUG === "true")
        throw new Error("Non-debug instance with DEBUG=true");
      verifyBuild(attData, build);
      verifyInstance(attData, instance);
      for (const release of releases) verifyRelease(attData, release);
      for (const pubkey of releasePolicy.signer_pubkeys) {
        if (!releases.find((r) => r.pubkey === pubkey))
          throw new Error("Release signer not found");
      }
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
    return {
      build,
      instance,
      releases,
      releasePolicy,
      instanceAnnounceRelays,
      prod,
    };
  }
}
