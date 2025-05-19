import { generateSecretKey } from "nostr-tools";
import { EnclavedClient } from "../modules/enclaved-client";

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
}: {
  relayUrl: string;
  adminPubkey: string;
  docker: string;
  units: number;
}) {
  const privkey = generateSecretKey();
  const client = await getClient(relayUrl, adminPubkey, privkey);
  const reply = await client.send({
    method: "launch",
    params: { docker, units },
  });
  console.log("launch", reply);
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
      return launch({ relayUrl, adminPubkey, docker, units });
    }
    default: {
      throw new Error("Unknown command");
    }
  }
}
