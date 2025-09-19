import {
  ENCLAVED_RELAY,
  SEARCH_RELAY,
} from "../modules/consts";
import { generateSecretKey } from "nostr-tools";
import { getIP } from "../modules/utils";
import { EnclavedClient } from "../modules/enclaved-client";
import { ParentClient } from "../modules/parent-client";
import { fetchDockerImageInfo } from "../modules/manifest";
import {
  fetchKeycruxServices,
  KeycruxClient,
  uploadKeycrux,
} from "../modules/keycrux-client";
import { nsmInit } from "../modules/nsm";
import { checkUpgrade, isNewVersion } from "../modules/nostr";

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

async function parentGetIP({ port }: { port: number }) {
  const client = new ParentClient({ port });
  const r = await client.getIP();
  console.log(r.ip);
}

async function hasBackup(port: number) {
  const client = new ParentClient({ port });
  const r = await client.hasBackup();
  console.log(r.has_backup);
}

async function getKey(relayUrl: string, port: number) {
  nsmInit();

  const client = new ParentClient({ port });
  const { releases } = await client.getMeta();

  const services = await fetchKeycruxServices(relayUrl);
  if (!services.length) {
    console.error("No keycrux services");
    client.log("No keycrux services");
    return;
  }

  const promises = services.map(async (s) => {
    const relayUrl =
      s.tags.find((t) => t.length > 1 && t[0] === "relay")?.[1] ||
      ENCLAVED_RELAY;
    const client = new KeycruxClient({
      relayUrl,
      keycruxPubkey: s.pubkey,
    });
    await client.start();
    return client.get(releases);
  });
  const results = await Promise.allSettled(promises);
  const datas = results
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value);
  if (!datas.length) {
    console.error("No keys in keycrux");
    client.log("No keys in keycrux");
    return;
  }
  console.log("datas", datas);

  for (const data of datas) {
    try {
      if (typeof data !== "string" || !data.startsWith("AGE-SECRET-KEY-"))
        throw new Error("Invalid data");

      console.log(data);
      return;
    } catch (e) {
      console.error("Invalid data", e, data);
    }
  }
}

async function setKey(relayUrl: string, port: number) {
  nsmInit();

  const client = new ParentClient({ port });
  const { releases, releasePolicy } = await client.getMeta();

  const count = await uploadKeycrux(releasePolicy, releases, relayUrl);
  console.log("uploaded to keycrux services:", count);
}

async function dockerInspect(dockerUrl: string) {
  const manifest = await fetchDockerImageInfo({ imageRef: dockerUrl });
  console.log("manifest", manifest);
}

async function checkIsNewVersion(v1: string, v0: string) {
  const newer = isNewVersion(v1, v0);
  console.log("newer", newer, v1, "than", v0);
  return Promise.resolve();
}

async function log(message: string, port: number) {
  if (!message) throw new Error("Specify message");
  const client = new ParentClient({ port });
  await client.log(message);
  client.dispose();
  console.log("logged", message);
}

async function checkDockerUpgrade(
  signers: string[],
  relays: string[],
  repo: string,
  version: string
) {
  const releases = await checkUpgrade(signers, relays, repo, version);
  console.log(
    "new releases",
    releases.map((r) => JSON.stringify(r))
  );
}

export function mainCli(argv: string[]) {
  if (!argv.length) throw new Error("Command not specified");

  const method = argv[0];
  switch (method) {
    case "get_ip": {
      const ip = getIP();
      console.log("ip", ip);
      return Promise.resolve();
    }
    case "get_key": {
      const relayUrl = argv?.[1] || SEARCH_RELAY;
      const port = Number(argv?.[2]) || 2080;
      return getKey(relayUrl, port);
    }
    case "has_backup": {
      const port = Number(argv?.[1]) || 2080;
      return hasBackup(port);
    }
    case "set_key": {
      const relayUrl = argv?.[1] || SEARCH_RELAY;
      const port = Number(argv?.[2]) || 2080;
      return setKey(relayUrl, port);
    }
    case "log": {
      const message = argv[1];
      const port = Number(argv?.[2]) || 2080;
      return log(message, port);
    }
    case "parent_get_ip": {
      const port = Number(argv[1]) || 2080;
      return parentGetIP({ port });
    }
    case "docker_inspect": {
      const dockerUrl = argv[1];
      return dockerInspect(dockerUrl);
    }
    case "is_new_version": {
      return checkIsNewVersion(argv[1], argv[2]);
    }
    case "check_docker_upgrades": {
      const signers = argv[1].split(",");
      const relays = argv[2].split(",");
      const repo = argv[3];
      const version = argv[4];
      return checkDockerUpgrade(signers, relays, repo, version);
    }
    default: {
      throw new Error("Unknown command");
    }
  }
}
