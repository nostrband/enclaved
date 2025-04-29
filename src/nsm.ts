import { open, getAttestationDoc, close } from "aws-nitro-enclaves-nsm-node";
import { decode } from "cbor2";
import { AttestationData } from "./types";

let fd: number = -1;

export function nsmInit() {
  fd = open();
}

export function nsmDeinit() {
  if (fd >= 0) close(fd);
  fd = -1;
}

export function nsmGetAttestation(pubkey?: string) {
  if (fd < 0) return "";

  return getAttestationDoc(
    fd,
    null, // user data
    null, // nonce
    pubkey ? Buffer.from(pubkey, "hex") : null
  );
}

export function nsmParseAttestation(att: Buffer) {
  const COSE_Sign1: Uint8Array[] = decode(att);
  console.log("COSE_Sign1", COSE_Sign1);
  if (COSE_Sign1.length !== 4) throw new Error("Bad attestation");

  const data: AttestationData = decode(COSE_Sign1[2]);
  console.log("data", data);
  return data;
}
