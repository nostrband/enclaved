import fs from "node:fs";
import { getPublicKey, nip19 } from "nostr-tools";
import { exec } from "./utils";
import { DBContainer } from "./db";
import { ContainerContext } from "./enclave/container";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";

const DISK_PER_UNIT_MB = 50;

export interface LaunchRequest {
  dir: string;
  docker: string;
  units?: number;
  env?: any;
  key: Uint8Array;
  prod: boolean;
}

async function checkImage(image: string) {
  const args = [
    "run",
    "--rm",
    "quay.io/skopeo/stable",
    "inspect",
    `docker://docker.io/${image}`,
  ];

  // format nostrband/nwc-enclaved@sha256:adbf495b2c132e5f0f9a1dc9c20eff51580f9c3127b829d6db7c0fe20f11bbd7
  const { out, err, code } = await exec("docker", args);
  if (code !== 0) throw new Error("Failed to fetch docker image");

  try {
    const info = JSON.parse(out);
    let size = 0;
    for (const d of info.LayersData) {
      size += d.Size;
    }
    console.log(new Date(), "docker", image, "size", size);
    if (size > 300000000) throw new Error("Image too big");
  } catch (e) {
    console.error(new Date(), "Bad docker info", image, out, e);
    throw new Error("Failed to parse image info");
  }
}

function getPath(cont: DBContainer, context: ContainerContext) {
  const pubkey = getPublicKey(cont.seckey);
  return context.dir + "/metadata/" + pubkey;
}

async function compose(params: {
  cont: DBContainer;
  context: ContainerContext;
  cmd: "up" | "down" | "stop" | "logs";
  dry?: boolean;
}) {
  const path = getPath(params.cont, params.context) + "/compose.yaml";
  const args = ["compose", "-f", path, "-p", params.cont.pubkey];
  args.push(params.cmd);
  if (params.dry) args.push("--dry-run");
  if (params.cmd === "up") args.push("-d");
  if (params.cmd === "logs") args.push(...["-n", "500"]);

  const { code } = await exec("docker", args);
  if (code !== 0) throw new Error("Failed to run docker compose");
}

export async function stop(cont: DBContainer, context: ContainerContext) {
  await compose({ cont, context, cmd: "stop" });
}

export async function down(cont: DBContainer, context: ContainerContext) {
  await compose({ cont, context, cmd: "down" });
}

export async function logs(cont: DBContainer, context: ContainerContext) {
  await compose({ cont, context, cmd: "logs" });
}

export async function up(cont: DBContainer, context: ContainerContext) {
  if (!cont.docker) throw new Error("Specify docker url");

  // pull to ensure it's available
  const pull = await exec("docker", ["pull", cont.docker]);
  if (pull.code !== 0) throw new Error("Failed to pull the docker image");

  // extract list of volumes
  const inspect = await exec("docker", [
    "image",
    "inspect",
    cont.docker,
    "--format='{{range $k, $_ := .Config.Volumes}}{{println $k}}{{end}}'",
  ]);
  if (inspect.code !== 0) throw new Error("Failed to inspect docker image");

  const volumes = inspect.out.trim()
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  console.log("volumes", cont.docker, volumes);
  const usedVolumes = new Map<string, string>();
  let volumesConf = "";
  let volumesMount = "";
  if (volumes) {
    // create volumes if not exist
    const size = Math.floor((cont.units * DISK_PER_UNIT_MB) / volumes.length);
    for (const path of volumes) {
      if (!path.trim()) continue;

      // naming: hash(path)
      const name = bytesToHex(sha256(path)).substring(0, 14);
      usedVolumes.set(name, path);
      if (!volumesConf) volumesConf = "volumes:\n";
      volumesConf += `  ${name}:
    driver: local
    driver_opts:
      o: size=${size}M
`;
      if (!volumesMount) volumesMount = "volumes:\n";
      volumesMount += `      - ${name}:${path}\n`;
      // const { code } = await exec("docker", ["volume", "inspect", name]);
      // if (code === 0) {
      //   console.log("volume", path, name, "for", cont.pubkey, "exists");
      // } else {
      //   const { code } = await exec("docker", [
      //     "volume",
      //     "create",
      //     ...["--driver", "local"],
      //     ...["--opt", `o=size=${size}M`],
      //     name,
      //   ]);
      //   if (code !== 0) throw new Error("Failed to create docker volume");
      // }
    }
  }
  console.log("used volumes", usedVolumes);

  // remove old volumes for this pubkey
  const ls = await exec("docker", ["volume", "ls", "-q"]);
  if (ls.code !== 0) throw new Error("Failed to list docker volumes");
  const unusedVolumes = ls.out
    .split("\n")
    .filter((s) => s.startsWith(cont.pubkey))
    .filter((s) => !usedVolumes.has(s.trim()));
  console.log("unused volumes", unusedVolumes);
  if (unusedVolumes.length) {
    const rm = await exec("docker", ["volume", "rm", ...unusedVolumes]);
    if (rm.code !== 0)
      throw new Error("Failed to remove unused docker volumes");
  }

  // prepare compose.yaml
  const units = cont.units || 1;
  if (units > 50) throw new Error("Max units = 50");

  const cpus = 0.1 * units;
  const memory = 50 * units;
  const pids = 10 * units;
  const disk = DISK_PER_UNIT_MB * units;

  const envObj = cont.env || {};
  let env = `environment:
      ENCLAVE: ${
        process.env["DEBUG"] === "true"
          ? "debug"
          : context.prod
          ? "prod"
          : "dev"
      }`;

  for (const key of Object.keys(envObj)) {
    if (typeof envObj[key] !== "string") throw new Error("Invalid env value");
    if (key.includes(" ") || key.includes("\n"))
      throw new Error("Invalid env key");
    env += `\n      ${key}: ${envObj[key]}`;
  }

  // await this.checkImage(req.params.docker);

  const path = getPath(cont, context);
  fs.mkdirSync(path, { recursive: true });
  fs.writeFileSync(path + "/key.sk", nip19.nsecEncode(cont.seckey));

  const conf = `
services:
  main:
    image: ${cont.docker}
    ${env}
    ${volumesMount}
    storage_opt:
      size: '${disk}M'
    deploy:
      restart_policy:
        condition: on-failure
        delay: 10s
        max_attempts: 10
        window: 120s
      resources:
        limits:
          cpus: '${cpus}'
          memory: ${memory}M
          pids: ${pids}
    
networks:
  default:
    external: true
    name: enclaves
${volumesConf}
`;
  console.log("compose", conf);
  const composePath = path + "/compose.yaml";
  fs.writeFileSync(composePath, conf);

  await compose({ cont, context, cmd: "up", dry: true });

  await compose({ cont, context, cmd: "up", dry: false });
}
