import { generateSecretKey, getPublicKey } from "nostr-tools";
import { DB, DBContainer } from "../modules/db";
import { EnclavedServer, Reply, Request } from "../modules/enclaved";
import { Container, ContainerContext } from "./container";
import {
  CHARGE_INTERVAL,
  DISK_PER_UNIT_MB,
  MIN_PORTS_FROM,
  NWC_RELAY,
  PORTS_PER_CONTAINER,
  SATS_PER_UNIT_PER_INTERVAL,
  TOTAL_UNITS,
} from "../modules/consts";
import { bytesToHex, randomBytes } from "@noble/hashes/utils";
import { now } from "../modules/utils";
import { fromNWC, NWCClient } from "../modules/nwc-client";
import { NWCTransaction } from "../modules/nwc-types";
import { fetchDockerImageInfo } from "../modules/manifest";
import { Relay } from "../modules/relay";

export class AppServer extends EnclavedServer {
  private off: boolean = false;
  private context: ContainerContext;
  private conf: any;
  private db: DB;
  private conts = new Map<string, Container>();
  private nwcRelay = new Relay(NWC_RELAY);
  private nwcClients = new Map<string, NWCClient>();
  private startedContainers = false;

  constructor(context: ContainerContext, conf: any) {
    super(context.serviceSigner);
    this.conf = conf;
    this.context = context;
    this.db = new DB(context.dir + "/containers.db");
    console.log("existing containers:");
    this.db.listContainers().map((c) => console.log("cont", c));
  }

  public getContext(): ContainerContext {
    return this.context;
  }

  public getContainerByToken(token: string): Container | undefined {
    return [...this.conts.values()].find((c) => c.info.token === token);
  }

  public async start() {
    // launch built-in containers first
    if (this.conf.builtin) {
      console.log("builtin", this.conf.builtin);
      await this.startBuiltin(this.conf.builtin);
    }

    // watch container uptime
    this.uptimeMonitor();
  }

  private async startContainers() {
    this.startedContainers = true;

    // now start other containers from db
    const conts = this.db.listContainers();
    for (const info of conts) {
      // we already started builtins, those that existed but were removed
      // from conf file we don't delete, just in case they will be re-activated etc
      if (info.isBuiltin) continue;

      // add it
      console.log("existing container", info.pubkey, info.portsFrom);
      const cont = new Container(info, this.context);
      this.conts.set(cont.info.pubkey, cont);

      // make sure NWC client is created and starts watching notifications
      await this.ensureWallet(cont);

      // make sure balances are up to date,
      // from now on we'll be subscribed to balance
      // events and will keep it updated
      await this.updateBalance(cont);

      // launch deployed container etc
      await cont.changeState(cont.info.state);
    }

    // start charge monitor
    await this.chargeMonitor();
  }

  public containerCount() {
    return this.conts.size;
  }

  private createContainerFromParams(
    params: any,
    isBuiltin: boolean
  ): DBContainer {
    const key = generateSecretKey();
    let portsFrom = MIN_PORTS_FROM;
    const conts = [...this.conts.values()];

    // find unused range
    while (conts.find((c) => c.info.portsFrom === portsFrom))
      portsFrom += PORTS_PER_CONTAINER;

    const pubkey = getPublicKey(key);
    return {
      id: 0,
      state: "waiting",
      isBuiltin,
      uptimeCount: 0,
      uptimePaid: 0,
      portsFrom,
      pubkey,
      seckey: key,
      token: bytesToHex(randomBytes(16)),
      units: params.units || 1,
      adminPubkey: "",
      docker: params.docker,
      env: params.env,
      name: params.name || pubkey,
      balance: 0,
    };
  }

  private async uptimeMonitor() {
    while (!this.off) {
      const start = Date.now();

      let count = 0;
      for (const c of this.conts.values()) {
        if (c.info.isBuiltin || c.info.state !== "deployed") continue;
        c.info.uptimeCount += 1;
        this.db.setContainerUptimeCount(c.info.pubkey, c.info.uptimeCount);
        count++;
      }
      console.log(Date.now(), "active paid conts", count);

      // wait 1 sec, compensate for the execution time above
      const diff = Date.now() - start;
      await new Promise((ok) => setTimeout(ok, 1000 - diff));
    }
  }

  private async chargeMonitor() {
    // scan containers every 1 second to check
    // if we need to change their state
    while (!this.off) {
      const start = Date.now();

      console.log(Date.now(), "charge monitor");
      for (const c of this.conts.values()) {
        if (c.info.isBuiltin) continue;

        // already deployed?
        if (c.info.state === "deployed") {
          if (c.info.uptimePaid <= c.info.uptimeCount) {
            // unpaid? try to charge, no need to
            // check balance - if charge fails we'll switch
            // the state and won't retry here
            const ok = await this.charge(c);
            // stop if insufficient_balance returned
            if (!ok) await this.pause(c);
          }
        } else if (c.info.state === "paused") {
          // paused and paid for some reason
          if (c.info.uptimePaid > c.info.uptimeCount) {
            // make sure it's running
            await this.deploy(c);
          } else if (this.hasEnoughBalance(c)) {
            // only try charging if seems to have enough
            // balance
            const ok = await this.charge(c);
            if (ok) await this.deploy(c);
          }
        } else if (c.info.state === "waiting") {
          // check the launch invoice, if ok - deploy,
          // if expired - the container will be removed
          const r = await this.checkWaitingPayment(c);
          if (r) await this.deploy(c);
        }
      }

      // pause for 1 sec
      const diff = Date.now() - start;
      await new Promise((ok) => setTimeout(ok, 1000 - diff));
    }
  }

  private async updateBalance(cont: Container) {
    const client = this.getNWC(cont);
    const { balance } = await client.getBalance();
    if (balance !== cont.info.balance) {
      cont.setBalance(balance);
      this.db.setContainerBalance(cont.info.pubkey, balance);
    }
  }

  private hasEnoughBalance(cont: Container) {
    return this.getAmountMsat(cont) <= cont.info.balance;
  }

  private async charge(cont: Container) {
    if (cont.info.isBuiltin) return;

    // keep trying to charge until extended over uptimeCount
    while (cont.info.uptimePaid <= cont.info.uptimeCount) {
      try {
        const parent = this.getParentNWC();
        const container = this.getNWC(cont);

        // amount to pay from container to parent
        const amount = this.getAmountMsat(cont);

        // parent makes an invoice
        const invoice = await parent.makeInvoice({
          amount,
          description: `Enclaved ${cont.info.units} units`,
        });
        console.log("invoice", invoice);

        // container pays the invoice
        await container.payInvoice({ invoice: invoice.invoice });

        // extend
        cont.info.uptimePaid += CHARGE_INTERVAL;
        this.db.setContainerUptimePaid(cont.info.pubkey, cont.info.uptimePaid);
        console.log(
          "container charged",
          cont.info.pubkey,
          cont.info.uptimePaid
        );

        // balance changed, update in background
        this.updateBalance(cont);
      } catch (e: any) {
        console.log("error charging container", cont.info.pubkey, e);

        if (e?.message === "INSUFFICIENT_BALANCE") {
          console.log(
            "INSUFFICIENT_BALANCE",
            cont.info.pubkey,
            cont.info.docker
          );
          // make sure we have updated balance to
          // avoid trying to charge again and again
          await this.updateBalance(cont);

          // insufficient balance
          return false;
        }

        // pause
        await new Promise((ok) => setTimeout(ok, 1000));
      }
    }

    return true;
  }

  private async pause(cont: Container) {
    // mark as deployed
    await cont.changeState("paused");
    this.db.setContainerState(cont.info.pubkey, cont.info.state);
  }

  private async deploy(cont: Container) {
    // mark as deployed
    await cont.changeState("deployed");
    this.db.setContainerState(cont.info.pubkey, cont.info.state);

    // start printing it's logs
    if (process.env["DEBUG"] === "true") cont.printLogs(true);
  }

  private async startBuiltin(builtins: any[]) {
    for (const params of builtins) {
      console.log("launch builtin", params);
      if (!params.name) throw new Error("Name not specified for builtin");

      let info = this.db.getNamedContainer(params.name);
      if (!info) {
        info = this.createContainerFromParams(params, true);
        console.log("new builtin", params.name, info.pubkey, info.portsFrom);
      } else {
        console.log(
          "existing builtin",
          params.name,
          info.pubkey,
          info.portsFrom
        );
        // might have changed
        info.docker = params.docker;
        info.env = params.env;
        info.units = params.units;
      }

      // save updated info
      this.db.upsertContainer(info);

      // add to our list
      const cont = new Container(info, this.context);
      this.conts.set(cont.info.pubkey, cont);

      // launch
      await this.deploy(cont);
    }
  }

  public async setContainerAppInfo(cont: Container, info: any) {
    const isWallet = cont.info.name === "nwc-enclaved";
    const oldInfo = cont.appInfo;

    cont.appInfo = info;

    // wallet updated it's pubkey?
    if (isWallet && oldInfo?.pubkey !== info.pubkey) {
      if (!this.startedContainers) {
        // now we can launch the containers
        this.startContainers();
      } else {
        // FIXME invalidate all the nwcClients?
      }
    }
  }

  private getAmountMsat(cont: Container, intervals: number = 1) {
    return cont.info.units * SATS_PER_UNIT_PER_INTERVAL * intervals * 1000;
  }

  private async onWalletTx(pubkey: string) {
    if (pubkey === (await this.context.serviceSigner.getPublicKey())) return;
    const cont = this.conts.get(pubkey);
    if (!cont) return;
    await this.updateBalance(cont);
  }

  private getNWCForKey(seckey: Uint8Array) {
    const pubkey = getPublicKey(seckey);
    const existingClient = this.nwcClients.get(pubkey);
    if (existingClient) return existingClient;

    const wallet = [...this.conts.values()].find(
      (c) => c.info.name === "nwc-enclaved"
    );
    if (!wallet) throw new Error("No builtin wallet");
    if (!wallet.appInfo || !wallet.appInfo.pubkey)
      throw new Error("Wallet not ready yet");

    const nostrWalletConnectUrl = `nostr+walletconnect://${
      wallet.appInfo.pubkey
    }?relay=${encodeURIComponent(NWC_RELAY)}&secret=${bytesToHex(seckey)}`;
    const client = fromNWC(nostrWalletConnectUrl, this.nwcRelay, () => {
      this.onWalletTx(pubkey);
    });
    this.nwcClients.set(pubkey, client);
    return client;
  }

  private getParentNWC() {
    return this.getNWCForKey(this.context.serviceSigner.unsafeGetSeckey());
  }

  private getNWC(cont: Container) {
    return this.getNWCForKey(cont.info.seckey);
  }

  private async createInvoice(cont: Container, amount: number) {
    const client = this.getNWC(cont);
    const description = `Enclaved launch ${cont.info.docker}, ${cont.info.units} units`;
    const invoice = await client.makeInvoice({ amount, description });
    return invoice;
  }

  private async lookupLaunchInvoice(cont: Container) {
    if (!cont.info.paymentHash) throw new Error("No payment hash");

    const client = this.getNWC(cont);
    const tx = await client.lookupInvoice({
      payment_hash: cont.info.paymentHash,
    });
    return tx;
  }

  private async checkWaitingPayment(cont: Container) {
    try {
      let invoice: NWCTransaction | undefined;
      try {
        invoice = await this.lookupLaunchInvoice(cont);
      } catch (e: any) {
        console.log("lookup invoice error", e, cont.info.paymentHash);
        // WTF???
        if (e?.message === "NOT_FOUND") throw new Error("Invoice disappeared!");
      }

      // connection issues, just keep trying
      if (!invoice) return;

      // got the invoice
      if (invoice.state === "settled") {
        console.log("new container paid", cont.info.pubkey);
        return true;
      } else if (invoice.expires_at! < now()) {
        console.log("new container expired", cont.info.pubkey);

        // cleanup
        this.conts.delete(cont.info.pubkey);
        this.db.deleteContainer(cont.info.pubkey);
      }
    } catch (e) {
      console.log(
        "Failed to lookup invoice",
        cont.info.pubkey,
        cont.info.paymentHash
      );
    }

    return false;
  }

  private async ensureWallet(cont: Container) {
    try {
      const parent = this.getParentNWC();
      await parent.addPubkey({
        pubkey: cont.info.pubkey,
      });
      this.getNWCForKey(cont.info.seckey);
    } catch {}
  }

  protected async launch(req: Request, res: Reply) {
    if (!this.startedContainers) throw new Error("Retry later");
    if (!req.params.docker) throw new Error("Specify docker url");
    if (!req.params.units || !parseInt(req.params.units))
      throw new Error("Specify units");

    const usedUnits = [...this.conts.values()]
      .map((c) => c.info.units)
      .reduce((a, c) => a + c, 0);
    if (usedUnits + req.params.units > TOTAL_UNITS)
      throw new Error("Not enough free units");

    const manifest = await fetchDockerImageInfo({
      imageRef: req.params.docker,
    });
    console.log("manifest of", req.params.docker, manifest);
    const imageSize = manifest.layers.reduce((a, l) => (a += l.size), 0);
    console.log("image size", req.params.docker, imageSize);
    if (imageSize > (req.params.units * DISK_PER_UNIT_MB * 1024 * 1024) / 2)
      throw new Error("Need more units for this image");

    // create key and container info
    const info = this.createContainerFromParams(req.params, false);
    info.adminPubkey = req.pubkey;
    console.log("new container", req.params.name, info.pubkey, info.portsFrom);

    // add to RAM
    const cont = new Container(info, this.context);

    // create wallet first
    await this.ensureWallet(cont);

    // amount to prepay for first interval
    const amount = this.getAmountMsat(cont);

    // create invoice
    const invoice = await this.createInvoice(cont, amount);
    cont.info.paymentHash = invoice.payment_hash;

    // write to db, deployed=false
    this.db.upsertContainer(info);

    // add
    this.conts.set(cont.info.pubkey, cont);

    // set result
    res.result = {
      pubkey: info.pubkey,
      invoice,
    };
  }

  public async shutdown() {
    this.off = true;
    for (const c of this.conts.values()) {
      console.log("shutdown", c.info.pubkey);
      if (c.info.state === "deployed") await c.shutdown();
    }
  }
}
