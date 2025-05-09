import { Event, UnsignedEvent, nip19 } from "nostr-tools";
import { nsmGetAttestation, nsmParseAttestation } from "./nsm";
import { ANNOUNCEMENT_INTERVAL, KIND_INSTANCE, REPO } from "./consts";
import { now } from "./utils";
import { Signer } from "./types";
import {
  OUTBOX_RELAYS,
  publishInstance,
  publishInstanceProfile,
  publishStats,
  signPublish,
} from "./nostr";

export interface AnnounceParams {
  build?: Event;
  instance?: Event;
  signer: Signer;
  inboxRelayUrl: string;
  instanceAnnounceRelays?: string[];
  prod?: boolean;
  open?: boolean;
  getStats?: () => Promise<Map<string, string>>;
}

async function announce(p: AnnounceParams) {
  const pubkey = await p.signer.getPublicKey();
  const attestation = nsmGetAttestation(pubkey);
  console.log("attestation", attestation);

  let attestationString = "";
  let env = "debug";
  let pcrs: Map<number, Uint8Array> | undefined = undefined;
  if (attestation) {
    attestationString = attestation.toString("base64");
    const info = nsmParseAttestation(attestation);
    pcrs = info.pcrs;

    // PCR0=all_zeroes means we're in debug mode
    env = !pcrs.get(0)!.find((v) => v !== 0)
      ? "debug"
      : p.prod
      ? "prod"
      : "dev";
  }

  // kind 63793
  await publishInstance(p, attestationString, env, pcrs);

  // kind 0
  await publishInstanceProfile(p.signer, env, p.instanceAnnounceRelays);

  // kind 1
  if (p.getStats)
    await publishStats(p.signer, await p.getStats(), p.instanceAnnounceRelays);
}

export function startAnnouncing(opt: {
  build?: Event;
  instance?: Event;
  signer: Signer;
  inboxRelayUrl: string;
  instanceAnnounceRelays?: string[];
  prod?: boolean;
  getStats?: () => Promise<Map<string, string>>;
}) {
  const tryAnnounce = async () => {
    try {
      await announce(opt);

      // schedule next announcement
      setTimeout(tryAnnounce, ANNOUNCEMENT_INTERVAL);
    } catch (e) {
      console.log("Failed to announce", e);

      // retry faster than normal
      setTimeout(tryAnnounce, ANNOUNCEMENT_INTERVAL / 10);
    }
  };
  tryAnnounce();
}
