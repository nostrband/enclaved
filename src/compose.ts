import fs from "node:fs";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { exec } from "./utils";

export interface LaunchRequest {
  dir: string;
  docker: string;
  units?: number;
  env?: any;
  key: Uint8Array;
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

async function composeUp(params: {
  path: string;
  name: string;
  up: boolean;
  dry: boolean;
}) {
  const path = params.path + "/compose.yaml";
  const args = ["compose", "-f", path, "-p", params.name];
  if (params.up) args.push("up");
  else args.push("down");
  if (params.dry) args.push("--dry-run");
  args.push("-d");
  const { code } = await exec("docker", args);
  if (code !== 0) throw new Error("Failed to run docker compose");
}

export async function launch(params: LaunchRequest) {
  if (!params.docker) throw new Error("Specify docker url");

  const units = params.units || 1;
  if (units > 50) throw new Error("Max units = 50");

  const cpus = 0.1 * units;
  const memory = 50 * units;
  const pids = 10 * units;
  const disk = 50 * units;

  const envObj = params.env || {};
  let env = "";
  for (const key of Object.keys(envObj)) {
    if (typeof (envObj[key] !== "string")) throw new Error("Invalid env value");
    if (key.includes(" ") || key.includes("\n"))
      throw new Error("Invalid env key");
    env += `\n      - ${key}: ${envObj[key]}`;
  }
  if (env) env = "environment:" + env;

  // await this.checkImage(req.params.docker);

  const pubkey = getPublicKey(params.key);
  const path = params.dir + "/metadata/" + pubkey;
  fs.mkdirSync(path, { recursive: true });
  fs.writeFileSync(path + "/key.sk", nip19.nsecEncode(params.key));

  const compose = `
services:
  main:
    image: ${params.docker}
    ${env}
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
`;
  console.log("compose", compose);
  const composePath = path + "/compose.yaml";
  fs.writeFileSync(composePath, compose);

  await composeUp({ path, name: pubkey, up: true, dry: false });
}
