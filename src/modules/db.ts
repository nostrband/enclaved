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
  isBuiltin: boolean;
  env?: any;
  state: ContainerState;
  paymentHash?: string;
  uptimeCount: number;
  uptimePaid: number;
  balance: number;
}

export class DB {
  private db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    try {
      this.db.exec(`
      ALTER TABLE containers ADD COLUMN balance INTEGER DEFAULT 0
      `);
    } catch {
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
        uptime_count INTEGER DEFAULT 0,
        uptime_paid INTEGER DEFAULT 0,
        is_builtin INTEGER DEFAULT 0,
        env TEXT DEFAULT '',
        state TEXT,
        payment_hash TEXT DEFAULT '',
        balance INTEGER DEFAULT 0
      )
    `);
    }
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
      uptimeCount: (rec.uptime_count as number) || 0,
      uptimePaid: (rec.uptime_paid as number) || 0,
      portsFrom: rec.ports_from as number,
      pubkey: rec.pubkey as string,
      token: rec.token as string,
      seckey: hexToBytes(rec.seckey as string),
      units: rec.units as number,
      docker: rec.docker as string,
      env: rec.env ? JSON.parse(rec.env) : undefined,
      name: rec.name as string,
      paymentHash: rec.payment_hash as string,
      balance: rec.balance as number,
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

  public setContainerState(pubkey: string, state: string) {
    const up = this.db.prepare(`
      UPDATE containers SET state = ? WHERE pubkey = ?
    `);
    const r = up.run(state, pubkey);
    if (!r.changes) throw new Error("Failed to set container state");
  }

  public setContainerPaymentHash(pubkey: string, paymentHash: string) {
    const up = this.db.prepare(`
      UPDATE containers SET payment_hash = ? WHERE pubkey = ?
    `);
    const r = up.run(paymentHash, pubkey);
    if (!r.changes) throw new Error("Failed to set container payment_hash");
  }

  public setContainerUptimePaid(pubkey: string, uptimePaid: number) {
    const up = this.db.prepare(`
      UPDATE containers SET uptime_paid = ? WHERE pubkey = ?
    `);
    const r = up.run(uptimePaid, pubkey);
    if (!r.changes) throw new Error("Failed to set container uptime_paid");
  }

  public setContainerUptimeCount(pubkey: string, uptimeCount: number) {
    const up = this.db.prepare(`
      UPDATE containers SET uptime_count = ? WHERE pubkey = ?
    `);
    const r = up.run(uptimeCount, pubkey);
    if (!r.changes) throw new Error("Failed to set container uptime_paid");
  }

  public setContainerBalance(pubkey: string, balance: number) {
    const up = this.db.prepare(`
      UPDATE containers SET balance = ? WHERE pubkey = ?
    `);
    const r = up.run(balance, pubkey);
    if (!r.changes) throw new Error("Failed to set container balance");
  }

  public deleteContainer(pubkey: string) {
    const del = this.db.prepare(`
      DELETE FROM containers WHERE pubkey = ?
    `);
    const r = del.run(pubkey);
    if (!r.changes) throw new Error("Failed to delete container");
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
