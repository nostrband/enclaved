import fs from "node:fs";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { exec } from "./utils";

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

async function compose(params: {
  path: string;
  name?: string;
  cmd: "up" | "down" | "stop" | "logs";
  dry: boolean;
}) {
  const path = params.path + "/compose.yaml";
  const args = ["compose", "-f", path];
  if (params.name) args.push(...["-p", params.name]);
  args.push(params.cmd);
  if (params.dry) args.push("--dry-run");
  if (params.cmd === "up") args.push("-d");
  if (params.cmd === "logs") args.push(...["-n", "500"]);

  const { code } = await exec("docker", args);
  if (code !== 0) throw new Error("Failed to run docker compose");
}

export async function stop(dir: string, pubkey: string) {
  const path = dir + "/metadata/" + pubkey;
  await compose({ path, cmd: "stop", dry: false });
}

export async function logs(dir: string, pubkey: string) {
  const path = dir + "/metadata/" + pubkey;
  await compose({ path, cmd: "logs", dry: false });
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
  let env = `environment:
      ENCLAVE: ${
        process.env["DEBUG"] === "true" ? "debug" : params.prod ? "prod" : "dev"
      }`;

  for (const key of Object.keys(envObj)) {
    if (typeof envObj[key] !== "string") throw new Error("Invalid env value");
    if (key.includes(" ") || key.includes("\n"))
      throw new Error("Invalid env key");
    env += `\n      ${key}: ${envObj[key]}`;
  }

  // await this.checkImage(req.params.docker);

  const pubkey = getPublicKey(params.key);
  const path = params.dir + "/metadata/" + pubkey;
  fs.mkdirSync(path, { recursive: true });
  fs.writeFileSync(path + "/key.sk", nip19.nsecEncode(params.key));

  const conf = `
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
  console.log("compose", conf);
  const composePath = path + "/compose.yaml";
  fs.writeFileSync(composePath, conf);

  await compose({ path, cmd: "up", name: pubkey, dry: true });

  await compose({ path, cmd: "up", name: pubkey, dry: false });
}
