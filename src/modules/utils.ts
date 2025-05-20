import { networkInterfaces } from "os";
import { bytesToHex, randomBytes } from "@noble/hashes/utils";
import { spawn } from "child_process";

export function now() {
  return Math.floor(Date.now() / 1000);
}

export class PubkeyBatcher {
  private batchSize: number;
  private pubkeyRelays = new Map<string, Set<string>>();
  private relayReqs = new Map<string, Map<string, string[]>>();

  constructor(batchSize: number) {
    this.batchSize = batchSize;
  }

  public add(pubkey: string, relay: string): [string, string[]] {
    const relays = this.pubkeyRelays.get(pubkey) || new Set();
    if (relays.has(relay)) return ["", []];

    // add relay to pubkey
    relays.add(relay);
    this.pubkeyRelays.set(pubkey, relays);

    const reqs = this.relayReqs.get(relay) || new Map();
    this.relayReqs.set(relay, reqs);

    let id = [...reqs.entries()].find(
      ([_, pubkeys]) => pubkeys.length < this.batchSize
    )?.[0];
    if (!id) {
      id = bytesToHex(randomBytes(6));
      reqs.set(id, []);
    }
    const reqPubkeys = reqs.get(id)!;
    reqPubkeys.push(pubkey);

    return [id, reqPubkeys];
  }

  public relays(pubkey: string) {
    const relays = this.pubkeyRelays.get(pubkey);
    return relays ? [...relays.values()] : [];
  }

  public remove(pubkey: string, relay: string): [string, string[]] {
    const empty = ["", []] as [string, string[]];
    const relays = this.pubkeyRelays.get(pubkey);
    if (!relays) return empty;

    // delete relay from pubkey
    if (!relays.delete(relay)) return empty;
    this.pubkeyRelays.set(pubkey, relays);

    const reqs = this.relayReqs.get(relay);
    if (!reqs) return empty;

    for (const [id, pubkeys] of reqs.entries()) {
      const index = pubkeys.findIndex((p) => p === pubkey);
      if (index >= 0) {
        pubkeys.splice(index, 1);
        if (!pubkeys.length) reqs.delete(id);
        return [id, pubkeys];
      }
    }

    return empty;
  }

  public has(pubkey: string) {
    return this.pubkeyRelays.has(pubkey);
  }
}

export function normalizeRelay(r: string) {
  try {
    const u = new URL(r);
    if (u.protocol !== "wss:" && u.protocol !== "ws:") return undefined;
    if (u.hostname.endsWith(".onion")) return undefined;
    if (u.hostname === "localhost") return undefined;
    if (u.hostname === "127.0.0.1") return undefined;
    return u.href;
  } catch {}
}

export function getIP(prefix?: string) {
  const prefixes = prefix ? [prefix] : ["eth", "ens", "enp"];
  const nets: any = networkInterfaces();
  // console.log("nets", nets);
  for (const name of Object.keys(nets)) {
    if (!prefixes.find(p => name.startsWith(p))) continue;
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

export async function exec(cmd: string, args: string[]) {
  console.log("exec", cmd, args);
  const child = spawn(cmd, args);
  return await new Promise<{
    out: string;
    err: string;
    code: number;
  }>((ok) => {
    let out = "";
    let err = "";
    child.stdout.on("data", (data) => {
      out += data;
      console.log(`${cmd} stdout: ${data}`);
    });

    child.stderr.on("data", (data) => {
      err += data;
      console.error(`${cmd} stderr: ${data}`);
    });

    child.on("close", (c) => {
      console.log(`${cmd} exit code ${c}`);
      const code = c || 0;
      ok({ err, out, code });
    });
  });

}