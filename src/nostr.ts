import fs from "node:fs";
import { Event, UnsignedEvent, nip19 } from "nostr-tools";
import { Signer } from "./types";
import {
  KIND_ENCLAVED_ATTESTATION,
  KIND_ENCLAVED_CONTAINER,
  KIND_INSTANCE,
  KIND_PROFILE,
  KIND_RELAYS,
  REPO,
} from "./consts";
import { now } from "./utils";
import { Relay } from "./relay";
import { AnnounceParams } from "./announce";
import { bytesToHex } from "@noble/hashes/utils";
import { DBContainer } from "./db";

const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.primal.net",
  "wss://nostr.mom",
];

export const OUTBOX_RELAYS = [
  "wss://relay.primal.net",
  "wss://relay.nostr.band",
  "wss://purplepag.es",
  "wss://user.kindpag.es",
  "wss://relay.nos.social",
];

export async function publish(event: Event, relays?: string[]) {
  const promises = (relays || DEFAULT_RELAYS).map((r) => {
    const relay = new Relay(r);
    return relay.publish(event).finally(() => relay.dispose());
  });
  const results = await Promise.allSettled(promises);
  if (!results.find((r) => r.status === "fulfilled"))
    throw new Error("Failed to publish");
  return event;
}

export async function signPublish(
  event: UnsignedEvent,
  signer: Signer,
  relays?: string[]
) {
  const signed = await signer.signEvent(event);
  return await publish(signed, relays);
}

export async function publishNip65Relays(signer: Signer, relays?: string[]) {
  const tmpl: UnsignedEvent = {
    pubkey: await signer.getPublicKey(),
    kind: KIND_RELAYS,
    created_at: now(),
    content: "",
    tags: (relays || DEFAULT_RELAYS).map((r) => ["r", r]),
  };

  const event = await signPublish(tmpl, signer, OUTBOX_RELAYS);
  console.log("published outbox relays", event, OUTBOX_RELAYS);
}

export async function publishInstance(
  p: AnnounceParams,
  attestation: string,
  env: string,
  pcrs?: Map<number, Uint8Array>
) {
  const {
    signer,
    prod,
    open,
    build,
    instance,
    inboxRelayUrl,
    instanceAnnounceRelays,
  } = p;

  const pkg = JSON.parse(fs.readFileSync("package.json").toString("utf8"));
  console.log("pkg", pkg);

  const pubkey = await signer.getPublicKey();

  const ins: UnsignedEvent = {
    pubkey,
    kind: KIND_INSTANCE,
    created_at: now(),
    content: attestation,
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
      ["o", open ? "true" : "false"],
      ["comment", open ? "Open for new containers" : "Closed"],
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
  if (build) {
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
    // prof.tags.push(["p", instance.pubkey, "launcher"]);
    ins.tags.push(["instance", JSON.stringify(instance)]);
    ins.tags.push(["p", instance.pubkey, "launcher"]);
    const prod_ins = instance.tags.find(
      (t) => t.length > 1 && t[0] === "t" && t[1] === "prod"
    );
    if (!prod_ins && prod) {
      throw new Error("Instance is not for production!");
    }
  }

  // publish instance info
  await signPublish(ins, signer, instanceAnnounceRelays);
}

export async function publishInstanceProfile(
  signer: Signer,
  env: string,
  instanceAnnounceRelays?: string[]
) {
  // profile warning
  let warn = "";
  switch (env) {
    case "debug":
      warn =
        "DEBUG INSTANCE, not safe, may break or get terminated at any time!";
      break;
    case "dev":
      warn = "DEVELOPMENT INSTANCE, may break or get terminated at any time!";
      break;
  }

  // profile
  const pubkey = await signer.getPublicKey();
  const npub = nip19.npubEncode(pubkey);
  const prof: UnsignedEvent = {
    pubkey,
    kind: 0,
    created_at: now(),
    content: JSON.stringify({
      name: "enclaved",
      // picture: "https://nsec.app/favicon.ico",
      about: `An enclaved application server.\n
  This is an instance of enclaved running inside AWS Nitro Enclave.\n
  Validate instance attestation at https://enclaved.org/instances/${npub}\n
  Learn more at ${REPO}/blob/main/README.md\n
  ${warn}
  `,
    }),
    tags: [
      ["t", "enclaved"],
      ["r", REPO],
    ],
  };

  await signPublish(prof, signer, [
    ...(instanceAnnounceRelays || []),
    ...OUTBOX_RELAYS,
  ]);
}

export async function publishStats(
  signer: Signer,
  stats: Map<string, string>,
  relays?: string[]
) {
  const pubkey = await signer.getPublicKey();
  const event: UnsignedEvent = {
    pubkey,
    kind: 1,
    created_at: now(),
    content:
      "Stats:\n" +
      [...stats.entries()].map(([key, value]) => `${key}: ${value}`).join("\n"),
    tags: [["t", "enclaved"]],
  };
  await signPublish(event, signer, relays);
}

export async function publishContainerInfo(params: {
  info: DBContainer;
  serviceSigner: Signer;
  containerSigner: Signer;
  relays: string[];
  // stats: any;
}) {
  const pubkey = await params.containerSigner.getPublicKey();
  const servicePubkey = await params.serviceSigner.getPublicKey();
  const containerAttestation = await params.serviceSigner.signEvent({
    pubkey: servicePubkey,
    kind: KIND_ENCLAVED_ATTESTATION,
    created_at: now(),
    content: "",
    tags: [["p", pubkey, "container"]],
  });

  const containerInfo: UnsignedEvent = {
    pubkey,
    kind: KIND_ENCLAVED_CONTAINER,
    created_at: now(),
    content: "",
    tags: [
      ["p", servicePubkey, "enclaved"],
      [
        "attestation",
        JSON.stringify({
          id: containerAttestation.id,
          kind: containerAttestation.kind,
          created_at: containerAttestation.created_at,
          pubkey: containerAttestation.pubkey,
          content: containerAttestation.content,
          tags: containerAttestation.tags,
        }),
      ],
      // ["someInfo", "" + info.someInfo],
    ],
  };
  if (params.info.adminPubkey)
    containerInfo.tags.push(["p", params.info.adminPubkey, "admin"]);
  if (params.info.docker)
    containerInfo.tags.push(["r", params.info.docker, "docker"]);

  const containerEvent = await signPublish(
    containerInfo,
    params.containerSigner,
    [...params.relays, ...DEFAULT_RELAYS]
  );
  console.log(
    "published container info",
    containerEvent,
    params.relays,
    DEFAULT_RELAYS
  );

  // const npub = nip19.npubEncode(pubkey);
  const profile: UnsignedEvent = {
    pubkey,
    kind: KIND_PROFILE,
    created_at: now(),
    content: JSON.stringify({
      name: `container ${params.info.docker || ""}`,
      //      lud16: `${npub}@${npub}.zap.land`,
      about: `
This is a container running inside enclaved server.\n
Learn more at ${REPO}\n`,
      picture: "",
    }),
    tags: [["t", "enclaved-container"]],
  };

  const profileEvent = await signPublish(
    profile,
    params.containerSigner,
    OUTBOX_RELAYS
  );
  console.log("published profile", profileEvent, OUTBOX_RELAYS);

  //   const stats: UnsignedEvent = {
  //     pubkey: signer.getPublicKey(),
  //     kind: KIND_NOTE,
  //     created_at: now(),
  //     content: `Stats:
  // ${Object.keys(info.stats)
  //   .map((k) => `- ${k}: ${info.stats[k]}`)
  //   .join("\n")}
  //     `,
  //     tags: [],
  //   };

  //   const statsEvent = await signer.signEvent(stats);
  //   await publish(statsEvent, DEFAULT_RELAYS);
  //   console.log("published stats", statsEvent, DEFAULT_RELAYS);
}
