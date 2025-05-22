import fs from "node:fs";
import { Event, UnsignedEvent, nip19 } from "nostr-tools";
import { AttestationInfo, Signer } from "./types";
import {
  CERT_TTL,
  KIND_ENCLAVED_CERTIFICATE,
  KIND_ENCLAVED_PROCESS,
  KIND_INSTANCE,
  KIND_PROFILE,
  KIND_RELAYS,
  KIND_ROOT_CERTIFICATE,
  REPO,
} from "./consts";
import { now } from "./utils";
import { Relay } from "./relay";
import { AnnounceParams } from "./announce";
import { bytesToHex } from "@noble/hashes/utils";
import { DBContainer } from "./db";
import { PrivateKeySigner } from "./signer";

export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.primal.net",
  "wss://nostr.mom",
  "wss://relay.enclaved.org",
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

export async function prepareRootCertificate(
  info: AttestationInfo,
  signer: Signer
) {
  const servicePubkey = await signer.getPublicKey();
  const tmpl: UnsignedEvent = {
    pubkey: servicePubkey,
    kind: KIND_ROOT_CERTIFICATE,
    created_at: now(),
    content: info.base64,
    tags: [
      ["t", info.env],
      ["expiration", "" + (now() + CERT_TTL)],
      ["alt", "attestation certificate by AWS Nitro Enclave"],
    ],
  };
  return await signer.signEvent(tmpl);
}

export async function publishInstance(
  p: AnnounceParams,
  info: AttestationInfo,
  root: Event
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
    content: "",
    tags: [
      ["r", REPO],
      ["name", pkg.name],
      ["v", pkg.version],
      ["t", info.env],
      // admin interface relay with spam protection
      ["relay", inboxRelayUrl],
      // expires in 3 hours, together with attestation doc
      ["expiration", "" + (now() + CERT_TTL)],
      ["alt", "enclaved server"],
      ["o", open ? "true" : "false"],
      ["comment", open ? "Open for new containers" : "Closed"],
      ["tee_root", JSON.stringify(root)],
    ],
  };
  if (info.info?.pcrs) {
    ins.tags.push(
      // we don't use PCR3
      ...[0, 1, 2, 4, 8].map((id) => [
        "x",
        bytesToHex(info.info?.pcrs!.get(id)!),
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

export async function prepareContainerCert(params: {
  info: DBContainer;
  serviceSigner: Signer;
}) {
  const servicePubkey = await params.serviceSigner.getPublicKey();
  const tmpl: UnsignedEvent = {
    pubkey: servicePubkey,
    kind: KIND_ENCLAVED_CERTIFICATE,
    created_at: now(),
    content: "",
    tags: [
      ["p", params.info.pubkey, "container"],
      ["expiration", "" + (now() + CERT_TTL)],
      ["alt", "enclaved container certificate"],
    ],
  };
  if (params.info.docker)
    tmpl.tags.push(["r", `docker://${params.info.docker}`]);
  return await params.serviceSigner.signEvent(tmpl);
}

export async function publishContainerInfo(params: {
  info: DBContainer;
  root: Event;
  serviceSigner: Signer;
  relays: string[];
  // stats: any;
}) {
  const containerSigner = new PrivateKeySigner(params.info.seckey);

  const pubkey = await containerSigner.getPublicKey();

  const cert = await prepareContainerCert({
    info: params.info,
    serviceSigner: params.serviceSigner,
  });

  const servicePubkey = await params.serviceSigner.getPublicKey();
  const containerInfo: UnsignedEvent = {
    pubkey,
    kind: KIND_ENCLAVED_PROCESS,
    created_at: now(),
    content: "",
    tags: [
      ["p", servicePubkey, "enclaved"],
      ["tee_root", JSON.stringify(params.root)],
      ["tee_cert", JSON.stringify(cert)],
      ["alt", "enclaved container"],
      ["state", params.info.state],
    ],
  };
  if (params.info.adminPubkey)
    containerInfo.tags.push(["p", params.info.adminPubkey, "admin"]);
  if (params.info.docker)
    containerInfo.tags.push(["r", params.info.docker, "docker"]);

  const containerEvent = await signPublish(containerInfo, containerSigner, [
    ...params.relays,
    ...DEFAULT_RELAYS,
  ]);
  console.log(
    "published container info",
    containerEvent,
    params.relays,
    DEFAULT_RELAYS
  );

  const docker = params.info.docker ? `Docker: ${params.info.docker}` : "";
  const profile: UnsignedEvent = {
    pubkey,
    kind: KIND_PROFILE,
    created_at: now(),
    content: JSON.stringify({
      name: `container ${params.info.docker || ""}`,
      //      lud16: `${npub}@${npub}.zap.land`,
      about: `
This is a container running inside enclaved server.\n
${docker}\n
Learn more at ${REPO}\n
State: ${params.info.state}\n
Admin: ${params.info.adminPubkey || ""}\n
Balance: ${Math.floor(params.info.balance / 1000)}\n
`,
      picture: "",
    }),
    tags: [["t", "enclaved-container"]],
  };

  const profileEvent = await signPublish(
    profile,
    containerSigner,
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

export async function prepareAppCert(params: {
  info: DBContainer;
  appPubkey: string;
}) {
  const containerSigner = new PrivateKeySigner(params.info.seckey);
  const tmpl: UnsignedEvent = {
    pubkey: params.info.pubkey,
    kind: KIND_ENCLAVED_CERTIFICATE,
    created_at: now(),
    content: "",
    tags: [
      ["p", params.appPubkey, "app"],
      ["expiration", "" + (now() + CERT_TTL)],
      ["alt", "enclaved app certificate"],
    ],
  };
  return await containerSigner.signEvent(tmpl);
}
