import { generateSecretKey, getPublicKey } from "nostr-tools";
import { DB, DBContainer } from "../modules/db";
import { EnclavedServer, Reply, Request } from "../modules/enclaved";
import { Container, ContainerContext } from "./container";
import {
  DISK_PER_UNIT_MB,
  MIN_PORTS_FROM,
  PORTS_PER_CONTAINER,
  SATS_PER_UNIT_PER_HOUR,
  TOTAL_UNITS,
} from "../modules/consts";
import { bytesToHex, randomBytes } from "@noble/hashes/utils";
import { now } from "../modules/utils";
import { fromNWC } from "../modules/nwc-client";
import { NWCTransaction } from "../modules/nwc-types";
import { fetchDockerImageInfo } from "../modules/manifest";

export class AppServer extends EnclavedServer {
  private context: ContainerContext;
  private conf: any;
  private db: DB;
  private conts = new Map<string, Container>();

  constructor(context: ContainerContext, conf: any) {
    super(context.serviceSigner);
    this.conf = conf;
    this.context = context;
    this.db = new DB(context.dir + "/containers.db");
    console.log("existing containers:");
    this.db
      .listContainers()
      .map((c) =>
        console.log(
          "p",
          c.pubkey,
          "name",
          c.name,
          "builtin",
          c.isBuiltin,
          "docker",
          c.docker
        )
      );
  }

  public getContext(): ContainerContext {
    return this.context;
  }

  public getContainerByToken(token: string): Container | undefined {
    return [...this.conts.values()].find((c) => c.info.token === token);
  }

  public async start() {
    if (this.conf.builtin) {
      console.log("builtin", this.conf.builtin);
      await this.startBuiltin(this.conf.builtin);
    }

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

      // already deployed?
      if (info.state === "deployed") {
        await this.deploy(cont);
      } else {
        // check it's invoice and deploy or cleanup
        this.watchNewContPayment(cont);
      }
    }
  }

  public containerCount() {
    return this.conts.size;
  }

  private createContainerFromParams(
    params: any,
    isBuiltin: boolean
  ): DBContainer {
    const key = generateSecretKey();
    const maxPortsFrom = this.db.getMaxPortsFrom();
    const portsFrom = maxPortsFrom
      ? maxPortsFrom + PORTS_PER_CONTAINER
      : MIN_PORTS_FROM;
    const pubkey = getPublicKey(key);
    return {
      id: 0,
      state: "waiting",
      isBuiltin,
      paidUntil: 0,
      portsFrom,
      pubkey,
      seckey: key,
      token: bytesToHex(randomBytes(16)),
      units: params.units || 1,
      adminPubkey: "",
      docker: params.docker,
      env: params.env,
      name: params.name || pubkey,
    };
  }

  private async charge(cont: Container) {
    const parent = this.createParentNWC();
    const amount = this.getAmountMsat(cont, 1);

    // keep trying to charge until extended over 'now'
    while (cont.info.paidUntil <= now()) {
      try {
        const invoice = await parent.makeInvoice({
          amount,
          description: `Enclaved ${cont.info.units} units`,
        });
        const container = this.createNWC(cont);
        await container.payInvoice({ invoice: invoice.invoice });
        cont.info.paidUntil += 3600;
        this.db.setContainerPaidUntil(cont.info.pubkey, cont.info.paidUntil);
        console.log("container charged", cont.info.pubkey, cont.info.paidUntil);
      } catch (e) {
        console.log("error charging container", cont.info.pubkey, e);
        if (e === "INSUFFICIENT_BALANCE") {
          // FIXME pause etc
          console.log(
            "INSUFFICIENT_BALANCE",
            cont.info.pubkey,
            cont.info.docker
          );
          this.pause(cont);
          return;
        }
      }
    }

    // schedule next charge
    this.scheduleCharging(cont);
  }

  private async pause(cont: Container) {
    // mark as deployed
    cont.setState("paused");
    this.db.upsertContainer(cont.info);

    // launch
    await cont.down();
  }

  private scheduleCharging(cont: Container) {
    const nextCharge = cont.info.paidUntil + 3600;
    console.log(
      "container next charge",
      cont.info.pubkey,
      "in",
      nextCharge - now()
    );
    if (nextCharge > now())
      setTimeout(() => this.charge(cont), 1000 * (nextCharge - now() + 1));
    else this.charge(cont);
  }

  private async deploy(cont: Container) {
    // mark as deployed
    cont.setState("deployed");
    this.db.upsertContainer(cont.info);

    // launch
    await cont.up();

    // charge every 1 hour
    if (!cont.info.isBuiltin) this.scheduleCharging(cont);

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

      const cont = new Container(info, this.context);
      this.conts.set(cont.info.pubkey, cont);

      await this.deploy(cont);
    }
  }

  public async setContainerAppInfo(cont: Container, info: any) {
    cont.appInfo = info;
  }

  private getAmountMsat(cont: Container, hours: number) {
    return cont.info.units * SATS_PER_UNIT_PER_HOUR * hours * 1000;
  }

  private createNWCForKey(seckey: Uint8Array) {
    const wallet = [...this.conts.values()].find(
      (c) => c.info.name === "nwc-enclaved"
    );
    if (!wallet) throw new Error("No builtin wallet");
    if (!wallet.appInfo || !wallet.appInfo.pubkey)
      throw new Error("Wallet not ready yet");

    const nostrWalletConnectUrl = `nostr+walletconnect://${
      wallet.appInfo.pubkey
    }?relay=wss%3A%2F%2Frelay.zap.land&secret=${bytesToHex(seckey)}`;
    return fromNWC(nostrWalletConnectUrl);
  }

  private createParentNWC() {
    return this.createNWCForKey(this.context.serviceSigner.unsafeGetSeckey());
  }

  private createNWC(cont: Container) {
    return this.createNWCForKey(cont.info.seckey);
  }

  private async createInvoice(cont: Container, hours: number = 1) {
    const client = this.createNWC(cont);
    const description = `Enclaved ${cont.info.units} units`;
    const amount = this.getAmountMsat(cont, hours);
    const invoice = await client.makeInvoice({ amount, description });
    client.dispose();
    return invoice;
  }

  private async lookupInvoice(cont: Container) {
    if (!cont.info.paymentHash) throw new Error("No payment hash");

    const client = this.createNWC(cont);
    const tx = await client.lookupInvoice({
      payment_hash: cont.info.paymentHash,
    });
    client.dispose();
    return tx;
  }

  private watchNewContPayment(cont: Container) {
    // start watching the invoice
    const to = setInterval(async () => {
      try {
        let invoice: NWCTransaction | undefined;
        try {
          invoice = await this.lookupInvoice(cont);
        } catch (e) {
          console.log("lookup invoice error", e, cont.info.paymentHash);
          // WTF???
          if (e === "NOT_FOUND") throw new Error("Invoice disappeared!");
        }

        // connection issues, just keep trying
        if (!invoice) return;

        // got the invoice
        if (invoice.state === "settled") {
          // all ok
          clearInterval(to);
          console.log("new container paid", cont.info.pubkey);

          // 1 hour initially
          cont.info.paidUntil = now() + 3600;
          this.db.setContainerPaidUntil(cont.info.pubkey, cont.info.paidUntil);

          // deploy
          await this.deploy(cont);
        } else if (invoice.expires_at! < now()) {
          // expired
          clearInterval(to);
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
    }, 3000);
  }

  private async createWallet(cont: Container) {
    const client = this.createParentNWC();
    await client.addPubkey({
      pubkey: cont.info.pubkey,
    });
    client.dispose();
  }

  protected async launch(req: Request, res: Reply) {
    if (!req.params.docker) throw new Error("Specify docker url");
    if (!req.params.units || !parseInt(req.params.units))
      throw new Error("Specify units");

    const usedUnits = [...this.conts.values()]
      .map((c) => c.info.units)
      .reduce((a, c) => a + c, 0);
    if (usedUnits + req.params.units > TOTAL_UNITS)
      throw new Error("Not enough free units");

    const manifest = await fetchDockerImageInfo(req.params.docker);
    console.log("manifest of", req.params.docker, manifest);
    const imageSize = manifest.layers.reduce((a, l) => (a += l.size), 0);
    if (imageSize > (req.params.units * DISK_PER_UNIT_MB) / 1)
      throw new Error("Need more units for this image");

    // create key and container info
    const info = this.createContainerFromParams(req.params, false);
    console.log("new container", req.params.name, info.pubkey, info.portsFrom);

    // add to RAM
    const cont = new Container(info, this.context);

    // create wallet first
    await this.createWallet(cont);

    // create invoice
    const invoice = await this.createInvoice(cont);
    cont.info.paymentHash = invoice.payment_hash;

    // write to db, deployed=false
    this.db.upsertContainer(info);

    // add
    this.conts.set(cont.info.pubkey, cont);

    // watch for the payment and deploy or cleanup
    this.watchNewContPayment(cont);

    // set result
    res.result = {
      pubkey: info.pubkey,
      invoice,
    };
  }

  public async shutdown() {
    for (const c of this.conts.values()) {
      console.log("shutdown", c.info.pubkey);
      if (c.info.state === "deployed") await c.down();
    }
  }
}
