import fs from "node:fs";
import { getPublicKey, nip19 } from "nostr-tools";
import { exec } from "./utils";
import { DBContainer } from "./db";
import { ContainerContext } from "../enclave/container";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import { DISK_PER_UNIT_MB, VOLUME_PER_UNIT_MB } from "./consts";

export interface LaunchRequest {
  dir: string;
  docker: string;
  units?: number;
  env?: any;
  key: Uint8Array;
  prod: boolean;
}

export interface DockerImageInspect {
  Id: string;
  RepoTags?: string[];
  RepoDigests?: string[];
  Parent?: string;
  Comment?: string;
  Created: string;
  Config: {
    Volumes: any;
    WorkingDir: string;
    Entrypoint?: string[];
    Labels: any;
  };
  Architecture: string;
  Os: string;
  Size: number;
}

function getPath(cont: DBContainer, context: ContainerContext) {
  const pubkey = getPublicKey(cont.seckey);
  return context.dir + "/metadata/" + pubkey;
}

export function parseContainerImageLabels(labels?: Record<string, string>) {
  if (
    !labels ||
    !("signers" in labels) ||
    !("repo" in labels) ||
    !("signer_relays" in labels) ||
    !("version" in labels)
  )
    throw new Error("Invalid container image labels");

  const parse = (s: string) =>
    s
      .split(",")
      .map((s) => s.trim())
      .filter((s) => !!s);

  const signers = parse(labels["signers"]);
  const signerRelays = parse(labels["signer_relays"]);
  const upgradeRelays = labels["upgrade_relays"]
    ? parse(labels["upgrade_relays"])
    : signerRelays;
  const version = labels["version"];
  const repo = labels["repo"];
  return {
    signers,
    signerRelays,
    upgradeRelays,
    version,
    repo,
  };
}

export async function inspectContainerImage(image: string) {
  const info = await inspect(image);
  return parseContainerImageLabels(info.Config.Labels);
}

export async function inspect(image: string) {
  const args = ["image", "inspect", image];
  const { code, out } = await exec("docker", args);
  if (code !== 0) throw new Error("Failed to run docker inspect");

  try {
    const data = JSON.parse(out);
    return data[0] as DockerImageInspect;
  } catch (e) {
    console.log("Failed to inspect", image, e);
    throw new Error("Failed to inspect " + image);
  }
}

async function compose(params: {
  cont: DBContainer;
  context: ContainerContext;
  cmd: "up" | "down" | "stop" | "logs";
  dry?: boolean;
  follow?: boolean;
}) {
  const path = getPath(params.cont, params.context) + "/compose.yaml";
  const args = ["compose", "-f", path, "-p", params.cont.pubkey];
  args.push(params.cmd);
  if (params.dry) args.push("--dry-run");
  if (params.cmd === "up") args.push("-d");
  if (params.cmd === "logs")
    args.push(...(params.follow ? ["-f"] : ["-n", "500"]));

  if (params.cmd === "logs" && params.follow) {
    // background
    exec("docker", args);
  } else {
    const { code } = await exec("docker", args);
    if (code !== 0) throw new Error("Failed to run docker compose");
  }
}

export async function stop(cont: DBContainer, context: ContainerContext) {
  await compose({ cont, context, cmd: "stop" });
}

export async function down(cont: DBContainer, context: ContainerContext) {
  await compose({ cont, context, cmd: "down" });
}

export async function logs(
  cont: DBContainer,
  context: ContainerContext,
  follow?: boolean
) {
  await compose({ cont, context, cmd: "logs", follow });
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
    //    "--format='{{range $k, $_ := .Config.Volumes}}{{println $k}}{{end}}'",
  ]);
  if (inspect.code !== 0) throw new Error("Failed to inspect docker image");

  const image = JSON.parse(inspect.out.trim())[0];
  const volumes = Object.keys(image.Config.Volumes || {});
  console.log("volumes", cont.docker, volumes);

  // FIXME DEBUG
  const ls1 = await exec("docker", ["volume", "ls", "-q"]);
  console.log("ls1", ls1.out);

  const usedVolumes = new Map<string, string>();
  let volumesConf = "";
  let volumesMount = "";
  if (volumes) {
    // const dir = `/mnt/xfs/volumes/${cont.pubkey}`;
    // const mkdir = await exec("mkdir", ["-p", dir]);
    // if (mkdir.code !== 0) throw new Error("Failed to create container dir");

    // // total size Mb
    // const size = Math.floor(cont.units * DISK_PER_UNIT_MB);
    // const mkdir = await exec("xfs_quota", ["-x", "-c", `project -s ${name}`, "/mnt/xfs"]);

    for (const path of volumes) {
      if (!path.trim()) continue;

      const size = Math.floor(
        (cont.units * VOLUME_PER_UNIT_MB) / volumes.length
      );

      // naming: pubkey_hash(path)
      const name =
        cont.pubkey + "_" + bytesToHex(sha256(path)).substring(0, 14);
      usedVolumes.set(name, path);

      const create = await exec("docker", [
        "volume",
        "create",
        "-o",
        `size=${size}M`,
        name,
      ]);
      if (create.code !== 0) throw new Error("Failed to create docker volume");

      if (!volumesConf) volumesConf = "volumes:";
      volumesConf += `\n  ${name}:
    external: true`;
      // driver: local
      // driver_opts:
      //   o: size=${size}M
      //   type: xfs
      //   device: ${dir}`;

      if (!volumesMount) volumesMount = "volumes:";
      volumesMount += `\n      - ${name}:${path}`;
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

    for (const name of unusedVolumes) {
      const dir = `/mnt/xfs/volumes/${name}`;
      const rmdir = await exec("rm", ["-Rf", dir]);
      if (rmdir.code !== 0) throw new Error("Failed to delete volume dir");
    }
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
      ENCLAVED: ${
        process.env["DEBUG"] === "true"
          ? "debug"
          : context.prod
          ? "prod"
          : "dev"
      }
      ENCLAVED_TOKEN: ${cont.token}
      ENCLAVED_ENDPOINT: ${context.contEndpoint}`;

  for (const key of Object.keys(envObj)) {
    if (typeof envObj[key] !== "string") throw new Error("Invalid env value");
    if (key.includes(" ") || key.includes("\n"))
      throw new Error("Invalid env key");
    env += `\n      ${key}: ${envObj[key]}`;
  }

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
