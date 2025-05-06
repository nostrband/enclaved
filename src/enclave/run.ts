// run ASAP to override crypto.getRandomValues
nsmInit();

import { WebSocket } from "ws";
import { startEnclave } from "./index";
import { nsmInit } from "../nsm";

// @ts-ignore
global.WebSocket ??= WebSocket;

// used to launch the process inside the enclave
const parentPort = Number(process.argv?.[3]) || 2080;
const relayUrl = process.argv?.[4] || "wss://relay.primal.net";
const dir = process.argv?.[5] || "/enclaved_data";
startEnclave({ parentPort, relayUrl, dir });
