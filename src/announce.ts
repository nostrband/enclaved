import fs from "node:fs";
import {
  Event,
  UnsignedEvent,
  finalizeEvent,
  getPublicKey,
  nip19,
} from "nostr-tools";
import { nsmGetAttestation, nsmParseAttestation } from "./nsm";
import { ANNOUNCEMENT_INTERVAL, KIND_INSTANCE, REPO } from "./consts";
import { now } from "./utils";
import { bytesToHex } from "@noble/hashes/utils";
import { Relay } from "./relay";

export function startAnnouncing({
  build,
  instance,
  privkey,
  inboxRelayUrl,
  instanceAnnounceRelays = [],
  prod = false,
  getStats,
}: {
  build?: Event;
  instance?: Event;
  privkey: Uint8Array;
  inboxRelayUrl: string;
  instanceAnnounceRelays?: string[];
  prod?: boolean;
  getStats?: () => Promise<Map<string, string>>;
}) {
  const announce = async () => {
    const pubkey = getPublicKey(privkey);
    const attestation = nsmGetAttestation(pubkey);
    console.log("attestation", attestation);
    const pkg = JSON.parse(fs.readFileSync("package.json").toString("utf8"));
    console.log("pkg", pkg);

    let attestationString = "";
    let env = "";
    let pcrs: Map<number, Uint8Array> | undefined = undefined;
    if (attestation) {
      attestationString = attestation.toString("base64");
      const info = nsmParseAttestation(attestation);
      pcrs = info.pcrs;

      /**
  https://docs.aws.amazon.com/enclaves/latest/user/set-up-attestation.html
  PCR0	Enclave image file	A contiguous measure of the contents of the image file, without the section data.
  PCR1	Linux kernel and bootstrap	A contiguous measurement of the kernel and boot ramfs data.
  PCR2	Application	A contiguous, in-order measurement of the user applications, without the boot ramfs.
  PCR3	IAM role assigned to the parent instance	A contiguous measurement of the IAM role assigned to the parent instance. Ensures that the attestation process succeeds only when the parent instance has the correct IAM role.
  PCR4	Instance ID of the parent instance	A contiguous measurement of the ID of the parent instance. Ensures that the attestation process succeeds only when the parent instance has a specific instance ID.
  PCR8	Enclave image file signing certificate	A measure of the signing certificate specified for the enclave image file. Ensures that the attestation process succeeds only when the enclave was booted from an enclave image file signed by a specific certificate.
       */

      // PCR0=all_zeroes means we're in debug mode
      env = !pcrs.get(0)!.find((v) => v !== 0)
        ? "debug"
        : prod
        ? "prod"
        : "dev";
    }

    const ins: UnsignedEvent = {
      pubkey,
      kind: KIND_INSTANCE,
      created_at: now(),
      content: attestationString,
      tags: [
        ["r", REPO],
        ["name", pkg.name],
        ["v", pkg.version],
        ["t", env],
        // admin interface relay with spam protection
        ["relay", inboxRelayUrl],
        // expires in 3 hours, together with attestation doc
        ["expiration", "" + (now() + 3 * 3600)],
        ["alt", "enclaved instance"],
      ],
    };
    if (pcrs) {
      ins.tags.push(
        // we don't use PCR3
        ...[0, 1, 2, 4, 8].map((id) => [
          "x",
          bytesToHex(pcrs!.get(id)!),
          `PCR${id}`,
        ])
      );
    }

    const prof: UnsignedEvent = {
      pubkey,
      kind: 0,
      created_at: now(),
      content: JSON.stringify({
        name: "enclaved",
//        picture: "https://nsec.app/favicon.ico",
        about: `An enclaved application server.\n
This is an instance of enclaved running inside AWS Nitro Enclave.\n
Validate instance attestation at https://enclaved.org/instances/${nip19.npubEncode(
          pubkey
        )}\n
Learn more at https://github.com/nostrband/enclaved/blob/main/README.md\n`,
      }),
      tags: [
        ["t", "enclaved"],
      ],
    };

    const stats: UnsignedEvent | undefined = getStats
      ? {
          pubkey,
          kind: 1,
          created_at: now(),
          content:
            "Stats:\n" +
            [...(await getStats()).entries()]
              .map(([key, value]) => `${key}: ${value}`)
              .join("\n"),
          tags: [["t", "enclaved"]],
        }
      : undefined;

    if (build) {
      prof.tags.push(["p", build.pubkey, "builder"]);
      ins.tags.push(["build", JSON.stringify(build)]);
      ins.tags.push(["p", build.pubkey, "builder"]);
      const prod_build = build.tags.find(
        (t) => t.length > 1 && t[0] === "t" && t[1] === "prod"
      );
      if (!prod_build && prod) {
        throw new Error("Build is not for production!");
      }
    }
    if (instance) {
      prof.tags.push(["p", instance.pubkey, "launcher"]);
      ins.tags.push(["instance", JSON.stringify(instance)]);
      ins.tags.push(["p", instance.pubkey, "launcher"]);
      const prod_ins = instance.tags.find(
        (t) => t.length > 1 && t[0] === "t" && t[1] === "prod"
      );
      if (!prod_ins && prod) {
        throw new Error("Instance is not for production!");
      }
    }

    const publish = async (tmpl: UnsignedEvent) => {
      const signed = finalizeEvent(tmpl, privkey);
      console.log("signed", signed);
      const relays = [...instanceAnnounceRelays];
      if (!relays.length)
        relays.push(
          ...[
            "wss://relay.nostr.band",
            "wss://relay.damus.io",
            "wss://relay.primal.net",
          ]
        );

      const promises = relays.map((url) => {
        const r = new Relay(url);
        return r.publish(signed).finally(() => r.dispose());
      });

      const results = await Promise.allSettled(promises);
      if (!results.find((r) => r.status === "fulfilled"))
        throw new Error("Failed to publish");
    };

    try {
      // publish
      await publish(ins);
      await publish(prof);
      if (stats) await publish(stats);

      // schedule next announcement
      setTimeout(announce, ANNOUNCEMENT_INTERVAL);
    } catch (e) {
      console.log("Failed to announce", e);

      // retry faster than normal
      setTimeout(announce, ANNOUNCEMENT_INTERVAL / 10);
    }
  };
  announce();
}
