import { Event, UnsignedEvent, nip19 } from "nostr-tools";
import { nsmGetAttestation, nsmGetAttestationInfo, nsmParseAttestation } from "./nsm";
import { ANNOUNCEMENT_INTERVAL, KIND_INSTANCE, REPO } from "./consts";
import { now } from "./utils";
import { Signer } from "./types";
import {
  OUTBOX_RELAYS,
  prepareRootCertificate,
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

  const attestation = nsmGetAttestationInfo(pubkey, p.prod);
  console.log("attestation", attestation);

  // root cert / aws attestation event
  const root = await prepareRootCertificate(attestation, p.signer);

  // kind 63793
  await publishInstance(p, attestation, root);

  // kind 0
  await publishInstanceProfile(p.signer, attestation.env, p.instanceAnnounceRelays);

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
