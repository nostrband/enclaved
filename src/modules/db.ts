import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { DatabaseSync } from "node:sqlite";

export type ContainerState = "waiting" | "deployed" | "paused";

export interface DBContainer {
  id: number;
  pubkey: string;
  seckey: Uint8Array;
  token: string;
  adminPubkey?: string;
  portsFrom: number;
  name: string;
  docker?: string;
  units: number;
  paidUntil: number;
  isBuiltin: boolean;
  env?: any;
  state: ContainerState;
  paymentHash?: string;
}

export class DB {
  private db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS containers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pubkey TEXT,
        seckey TEXT,
        token TEXT,
        admin_pubkey TEXT DEFAULT '',
        ports_from INTEGER,
        name,
        docker TEXT DEFAULT '',
        units INTEGER DEFAULT 1,
        paid_until INTEGER DEFAULT 0,
        is_builtin INTEGER DEFAULT 0,
        env TEXT DEFAULT '',
        state TEXT,
        payment_hash TEXT DEFAULT ''
      )
    `);
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS containers_pubkey_index 
      ON containers (pubkey)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS containers_admin_pubkey_index
      ON containers (admin_pubkey)
    `);
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS containers_name_index
      ON containers (name)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS containers_state_index
      ON containers (state)
    `);
  }

  public dispose() {
    this.db.close();
  }

  private recToContainer(rec: Record<string, any>): DBContainer {
    return {
      id: rec.id as number,
      adminPubkey: (rec.admin_pubkey as string) || undefined,
      // @ts-ignore
      state: rec.state as string,
      isBuiltin: (rec.is_builtin || 0) > 0,
      paidUntil: (rec.paid_until as number) || 0,
      portsFrom: rec.ports_from as number,
      pubkey: rec.pubkey as string,
      token: rec.token as string,
      seckey: hexToBytes(rec.seckey as string),
      units: rec.units as number,
      docker: rec.docker as string,
      env: rec.env ? JSON.parse(rec.env) : undefined,
      name: rec.name as string,
      paymentHash: rec.payment_hash as string,
    };
  }

  public getNamedContainer(name: string) {
    const select = this.db.prepare(`
      SELECT * FROM containers WHERE name = ?
    `);
    const rec = select.get(name);
    if (!rec) return undefined;
    return this.recToContainer(rec);
  }

  public upsertContainer(c: DBContainer) {
    const upsert = this.db.prepare(`
      INSERT INTO containers (
        pubkey,
        seckey,
        token,
        admin_pubkey,
        ports_from,
        name,
        docker,
        units,
        is_builtin,
        env,
        state,
        payment_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE
      SET
        ports_from = ?,
        docker = ?,
        units = ?,
        env = ?,
        state = ?
    `);
    const env = c.env ? JSON.stringify(c.env) : "";
    const f = upsert.run(
      c.pubkey,
      bytesToHex(c.seckey),
      c.token,
      c.adminPubkey || "",
      c.portsFrom,
      c.name,
      c.docker || "",
      c.units,
      c.isBuiltin ? 1 : 0,
      env,
      c.state,
      c.paymentHash || "",

      c.portsFrom,
      c.docker || "",
      c.units,
      env,
      c.state
    );
    if (!f.changes) throw new Error("Failed to upsert container");
  }

  public setContainerPaymentHash(pubkey: string, paymentHash: string) {
    const up = this.db.prepare(`
      UPDATE containers SET payment_hash = ? WHERE pubkey = ?
    `);
    const r = up.run(paymentHash, pubkey);
    if (!r.changes) throw new Error("Failed to set container payment_hash");
  }

  public setContainerPaidUntil(pubkey: string, paidUntil: number) {
    const up = this.db.prepare(`
      UPDATE containers SET paid_until = ? WHERE pubkey = ?
    `);
    const r = up.run(paidUntil, pubkey);
    if (!r.changes) throw new Error("Failed to set container paid_until");
  }

  public deleteContainer(pubkey: string) {
    const del = this.db.prepare(`
      DELETE FROM containers WHERE pubkey = ?
    `);
    const r = del.run(pubkey);
    if (!r.changes) throw new Error("Failed to delete container");
  }

  public getMaxPortsFrom() {
    const select = this.db.prepare(`
      SELECT MAX(ports_from) as pf FROM containers
    `);
    const rec = select.get();
    return (rec?.ports_from as number) || 0;
  }

  public listContainers() {
    const select = this.db.prepare(`SELECT * FROM containers`);
    const recs = select.all();
    return recs.map((r) => this.recToContainer(r));
  }

  // public addMiningFeePaid(fee: number) {
  //   const fees = this.db.prepare(`
  //     INSERT INTO fees (id, mining_fee_paid)
  //     VALUES (1, ?)
  //     ON CONFLICT(id) DO UPDATE
  //     SET
  //       mining_fee_paid = mining_fee_paid + ?
  //   `);
  //   const f = fees.run(fee, fee);
  //   if (!f.changes) throw new Error("Failed to update mining_fee_paid");
  // }
}
