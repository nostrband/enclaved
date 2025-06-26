import { Event, generateSecretKey } from "nostr-tools";
import {
  ENCLAVED_RELAY,
  KEYCRUX_RELEASE_SIGNERS,
  KEYCRUX_REPO,
  KIND_KEYCRUX_RPC,
  REPO,
  SEARCH_RELAY,
} from "./consts";
import { Client } from "./client";
import { nsmGetAttestation, nsmParseAttestation } from "./nsm";
import { KIND_ANNOUNCEMENT, Validator } from "nostr-enclaves";
import fs from "node:fs";
import { fetchFromRelays } from "../cli/utils";
import { now } from "./utils";
import { ReleasePolicy } from "./types";
import { ParentClient } from "./parent-client";

export async function validateKeycrux(e: Event) {
  const validator = new Validator({
    expectedRelease: {
      ref: KEYCRUX_REPO,
      signerPubkeys: KEYCRUX_RELEASE_SIGNERS,
    },
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
      kinds: [KIND_ANNOUNCEMENT],
      "#r": [KEYCRUX_REPO],
      since: now() - 3 * 3600,
    },
    [relayUrl]
  );
  console.log("found keycrux announcements", services);
  if (!services.length) return [];

  const valid = new Map<string, Event>();
  for (const s of services) {
    if (valid.has(s.pubkey) && valid.get(s.pubkey)!.created_at > s.created_at)
      continue;
    if (await validateKeycrux(s)) valid.set(s.pubkey, s);
  }

  return [...valid.values()];
}

export async function uploadKeycrux(
  releasePolicy?: ReleasePolicy,
  releases?: Event[],
  relayUrl: string = SEARCH_RELAY,
) {
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
        const ok = await client.set(data, releasePolicy, releases);
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

export async function startKeycrux(
  parent: ParentClient,
  releasePolicy?: ReleasePolicy,
  releases?: Event[],
  relayUrl: string = SEARCH_RELAY
) {
  while (true) {
    const count = await uploadKeycrux(releasePolicy, releases, relayUrl);
    parent.log("keycrux uploaded " + count);
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

  public async get(releases?: Event[]) {
    const att = nsmGetAttestation(await this.getPublicKey());
    const params: any = {
      attestation: att.toString("base64"),
      input: {
        ref: REPO,
      },
    };

    const attData = att ? nsmParseAttestation(att) : undefined;
    const notDebug = !!attData?.pcrs.get(0)!.find((c) => c !== 0);

    if (releases && notDebug) {
      // the "policy" of last "set" will check these
      // inputs and release the key
      params.input.release_signatures = releases;
    }

    return (await this.send({
      method: "get",
      params,
    })) as string;
  }

  public async set(data: string, releasePolicy?: ReleasePolicy, releases?: Event[]) {
    const att = nsmGetAttestation(await this.getPublicKey());
    const params: any = {
      attestation: att.toString("base64"),
      data,
      input: {
        ref: REPO,
      },
      policy: {
        ref: REPO,
      },
    };

    const attData = att ? nsmParseAttestation(att) : undefined;
    const notDebug = !!attData?.pcrs.get(0)!.find((c) => c !== 0);
    if (releases && notDebug) {
      params.input.release_signatures = releases;
    }

    if (releasePolicy && notDebug) {
      params.policy.release_pubkeys = releasePolicy.signer_pubkeys;
    }

    return (
      (await this.send({
        method: "set",
        params,
      })) === "ok"
    );
  }
}
