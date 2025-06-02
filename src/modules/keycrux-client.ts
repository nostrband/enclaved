import { Event, generateSecretKey, getPublicKey } from "nostr-tools";
import {
  ENCLAVED_RELAY,
  KEYCRUX_PCR0,
  KEYCRUX_PCR1,
  KEYCRUX_PCR2,
  KEYCRUX_REPO,
  KIND_KEYCRUX_RPC,
  SEARCH_RELAY,
} from "./consts";
import { Client } from "./client";
import { nsmGetAttestation } from "./nsm";
import { KIND_INSTANCE, Validator } from "nostr-enclaves";
import { hexToBytes } from "@noble/hashes/utils";
import fs from "node:fs";
import { fetchFromRelays } from "../cli/utils";
import { now } from "./utils";

export async function validateKeycrux(e: Event) {
  const validator = new Validator({
    expectedPcrs: new Map([
      [0, hexToBytes(KEYCRUX_PCR0)],
      [1, hexToBytes(KEYCRUX_PCR1)],
      [2, hexToBytes(KEYCRUX_PCR2)],
    ]),
  });
  try {
    return await validator.validateInstance(e);
  } catch (err) {
    console.log("Invalid attestation of ", e.pubkey, e.id);
    return false;
  }
}

export async function fetchKeycruxServices(relayUrl: string = SEARCH_RELAY) {
  const services = await fetchFromRelays(
    {
      kinds: [KIND_INSTANCE],
      "#r": [KEYCRUX_REPO],
      since: now() - 3 * 3600,
    },
    [relayUrl]
  );
  if (!services.length) return [];

  const valid = new Map<string, Event>();
  for (const s of services) {
    if (valid.has(s.pubkey) && valid.get(s.pubkey)!.created_at > s.created_at)
      continue;
    // FIXME DEBUG
    if (1 || (await validateKeycrux(s))) valid.set(s.pubkey, s);
  }

  return [...valid.values()];
}

export async function uploadKeycrux(relayUrl: string = SEARCH_RELAY) {
  const file = fs.readFileSync("age.key").toString("utf8");
  if (!file) throw new Error("No age.key");
  const data = file
    .split("\n")
    .map((s) => s.trim())
    .find((s) => s.startsWith("AGE-SECRET-KEY-"));
  if (!data) throw new Error("No key in age.key");

  const services = await fetchKeycruxServices(relayUrl);
  console.log("valid keycrux services", services);
  let count = 0;
  if (services.length) {
    for (const s of services) {
      const serviceRelay =
        s.tags.find((t) => t.length > 1 && t[0] === "relay")?.[1] ||
        ENCLAVED_RELAY;

      console.log("sending key to", s.pubkey, serviceRelay);
      const client = new KeycruxClient({
        relayUrl: serviceRelay,
        keycruxPubkey: s.pubkey,
      });
      await client.start();

      try {
        const ok = await client.set(data);
        if (ok) {
          console.log(new Date(), "keycrux stored key at", s.pubkey, relayUrl);
          count++;
        } else {
          console.log(
            new Date(),
            "keycrux failed to store key at",
            s.pubkey,
            relayUrl
          );
        }
      } catch (e) {
        console.log("Failed to send to keycrux", s.pubkey, relayUrl, e);
      }
    }
  }

  return count;
}

export async function startKeycrux(relayUrl: string = SEARCH_RELAY) {
  while (true) {
    const count = await uploadKeycrux(relayUrl);
    const pause = count > 1 ? 600000 : 60000;
    await new Promise((ok) => setTimeout(ok, pause));
  }
}

export class KeycruxClient extends Client {
  constructor({
    relayUrl,
    keycruxPubkey,
  }: {
    privkey?: Uint8Array;
    relayUrl: string;
    keycruxPubkey: string;
  }) {
    const privkey = generateSecretKey();
    super({
      relayUrl,
      kind: KIND_KEYCRUX_RPC,
      signerPubkey: keycruxPubkey,
      privkey,
    });
  }

  public async start() {
    this.subscribe();
  }

  public async get() {
    const att = nsmGetAttestation(this.getPublicKey());
    return (await this.send({
      method: "get",
      params: {
        attestation: att.toString("base64"),
      },
    })) as string;
  }

  public async set(data: string) {
    const att = nsmGetAttestation(this.getPublicKey());
    return (
      (await this.send({
        method: "set",
        params: {
          attestation: att.toString("base64"),
          data,
        },
      })) === "ok"
    );
  }
}
