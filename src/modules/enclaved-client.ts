import { bytesToHex } from "@noble/hashes/utils";
import { generateSecretKey } from "nostr-tools";
import { KIND_ENCLAVED_RPC } from "./consts";
import fs from "node:fs";
import { Client } from "./client";

export class EnclavedClient extends Client {
  private filename?: string;
  private userPubkey?: string;

  constructor({
    relayUrl,
    filename,
    signerPubkey,
    privkey,
  }: {
    relayUrl: string;
    filename?: string;
    signerPubkey: string;
    privkey?: Uint8Array;
  }) {
    super({ relayUrl, kind: KIND_ENCLAVED_RPC, signerPubkey, privkey });
    this.filename = filename;
  }

  public async start() {
    if (this.filename) {
      try {
        const data = fs.readFileSync(this.filename).toString("utf8");
        const { csk, spk } = JSON.parse(data);
        if (csk && spk) {
          this.privkey = Buffer.from(csk, "hex");
          this.signerPubkey = spk;
        }
      } catch {}
    }

    if (!this.privkey) {
      this.privkey = generateSecretKey();
    }
    this.subscribe();

    if (this.filename) {
      fs.writeFileSync(
        this.filename,
        JSON.stringify({
          csk: bytesToHex(this.privkey!),
          spk: this.signerPubkey,
        })
      );
    }
  }

  async getPublicKey(): Promise<string> {
    if (this.userPubkey) return this.userPubkey;

    const pk = await this.send({
      method: "get_public_key",
      params: [],
    });
    if (pk.length !== 64) throw new Error("Invalid pubkey");
    this.userPubkey = pk;
    return pk;
  }
  async nip04Decrypt(pubkey: string, data: string): Promise<string> {
    return await this.send({
      method: "nip44_decrypt",
      params: [pubkey, data],
    });
  }
}
