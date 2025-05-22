// run ASAP to override crypto.getRandomValues
nsmInit();

import { WebSocket } from "ws";
import { startEnclave } from "./index";
import { nsmInit } from "../modules/nsm";

// @ts-ignore
global.WebSocket ??= WebSocket;

// used to launch the process inside the enclave
console.log("argv", process.argv);
console.log("env", process.env);
const parentPort = Number(process.argv?.[2]) || 2080;
const relayUrl = process.argv?.[3] || "wss://relay.enclaved.org";
const dir = process.argv?.[4] || "/enclaved_data";
startEnclave({ parentPort, relayUrl, dir });
