import { Event } from "nostr-tools";
import { nsmGetAttestationInfo } from "./nsm";
import { ANNOUNCEMENT_INTERVAL } from "./consts";
import { Signer } from "./types";
import {
  prepareRootCertificate,
  publishInstance,
  publishInstanceProfile,
  publishNip65Relays,
  publishStats,
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

  // attestation
  const attestation = nsmGetAttestationInfo(pubkey, p.prod);
  console.log("attestation", attestation);

  // root cert / aws attestation event
  const root = await prepareRootCertificate(attestation, p.signer);

  // kind 10002
  await publishNip65Relays(p.signer, p.instanceAnnounceRelays);

  // kind 63793
  await publishInstance(p, attestation, root);

  // kind 0
  await publishInstanceProfile(
    p.signer,
    attestation.env,
    p.instanceAnnounceRelays
  );

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
