// run ASAP to override crypto.getRandomValues
nsmInit();

import { WebSocket } from "ws";
import { startEnclave } from "./index";
import { nsmInit } from "../modules/nsm";
import { ENCLAVED_RELAY } from "../modules/consts";

// @ts-ignore
global.WebSocket ??= WebSocket;

// used to launch the process inside the enclave
console.log("argv", process.argv);
console.log("env", process.env);
const parentPort = Number(process.argv?.[2]) || 2080;
const relayUrl = process.argv?.[3] || ENCLAVED_RELAY;
const dir = process.argv?.[4] || "/enclaved_data";
startEnclave({ parentPort, relayUrl, dir });
