import { generateSecretKey } from "nostr-tools";
import { EnclavedClient } from "../modules/enclaved-client";
import { hexToBytes } from "nostr-tools/utils";

async function getClient(
  relayUrl: string,
  signerPubkey: string,
  privkey: Uint8Array
) {
  const client = new EnclavedClient({
    relayUrl,
    signerPubkey,
    privkey,
  });
  await client.start();
  return client;
}

async function ping({
  relayUrl,
  adminPubkey,
}: {
  relayUrl: string;
  adminPubkey: string;
}) {
  const privkey = generateSecretKey();
  const client = await getClient(relayUrl, adminPubkey, privkey);
  const start = Date.now();
  const reply = await client.send({
    method: "ping",
    params: [],
  });
  if (reply !== "pong") throw new Error("Invalid reply");
  console.log("ping", Date.now() - start, "ms");
}

async function launch({
  relayUrl,
  adminPubkey,
  docker,
  units,
  upgrade
}: {
  relayUrl: string;
  adminPubkey: string;
  docker: string;
  units: number;
  upgrade: string;
}) {
  const privkey = generateSecretKey();
  const client = await getClient(relayUrl, adminPubkey, privkey);
  const reply = await client.send({
    method: "launch",
    params: { docker, units, upgrade },
  });
  console.log("launch", reply);
}

async function info({
  relayUrl,
  adminPubkey,
  containerPubkey,
  privkeyHex
}: {
  relayUrl: string;
  adminPubkey: string;
  containerPubkey: string;
  privkeyHex: string;
}) {
  const privkey = hexToBytes(privkeyHex);
  const client = await getClient(relayUrl, adminPubkey, privkey);
  const reply = await client.send({
    method: "info",
    params: { pubkey: containerPubkey },
  });
  console.log("info", reply);
}

export function mainEnclavedCli(argv: string[]) {
  if (!argv.length) throw new Error("Command not specified");

  const method = argv[0];
  switch (method) {
    case "ping": {
      const relayUrl = argv[1];
      const adminPubkey = argv[2];
      return ping({ relayUrl, adminPubkey });
    }
    case "launch": {
      const relayUrl = argv[1];
      const adminPubkey = argv[2];
      const docker = argv[3];
      const units = Number(argv[4]);
      const upgrade = argv[5] || "";
      return launch({ relayUrl, adminPubkey, docker, units, upgrade });
    }
    case "info": {
      const relayUrl = argv[1];
      const adminPubkey = argv[2];
      const containerPubkey = argv[3];
      const privkeyHex = argv[4];
      return info({ relayUrl, adminPubkey, containerPubkey, privkeyHex });
    }
    default: {
      throw new Error("Unknown command");
    }
  }
}
