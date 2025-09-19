import { up, logs, down, execute } from "../modules/docker";
import { ContainerState, DBContainer } from "../modules/db";
import {
  DEFAULT_RELAYS,
  prepareRootCertificate,
  publishContainerInfo,
} from "../modules/nostr";
import { nsmGetAttestationInfo } from "../modules/nsm";
import { PrivateKeySigner } from "../modules/signer";
import { ParentClient } from "../modules/parent-client";
import { exec } from "../modules/utils";

export interface ContainerContext {
  dir: string;
  prod: boolean;
  serviceSigner: PrivateKeySigner;
  relays: string[];
  instanceAnnounceRelays?: string[];
  contEndpoint: string;
  parent: ParentClient;
}

export class Container {
  private off = false;
  private context: ContainerContext;
  private announcing = false;
  private state?: ContainerState;
  private appInfo?: any;
  private upgrading: boolean = false;

  info: DBContainer;
  walletPubkey?: string;

  constructor(info: DBContainer, context: ContainerContext) {
    this.info = info;
    this.context = context;
    this.startAnnounceLoop();
  }

  private async setState(s: ContainerState) {
    console.log(
      "container state",
      this.info.pubkey,
      this.info.state,
      "=>",
      s,
      "balance",
      this.info.balance,
      "paid",
      this.info.uptimePaid,
      "uptime",
      this.info.uptimeCount
    );

    this.state = s;
    this.info.state = s;

    // announcement for existing containers
    if (s !== "waiting") this.announce();

    // launch or pause
    if (s === "deployed") await this.up();
    else if (s === "paused") await this.down();
  }

  public startUpgrade() {
    this.upgrading = true;
  }

  public endUpgrade() {
    this.upgrading = false;
  }

  public isUpgrading() {
    return this.upgrading;
  }

  public async changeState(s: ContainerState) {
    if (this.state === s) return;
    await this.setState(s);
  }

  public setBalance(b: number) {
    if (this.info.balance === b) return;

    this.info.balance = b;
    this.announce();
  }

  public getAppInfo() {
    return this.appInfo;
  }

  public setAppInfo(appInfo: any) {
    if (this.appInfo === appInfo) return;
    if (this.appInfo?.pubkey !== appInfo?.pubkey) this.announce();
    this.appInfo = appInfo;
  }

  private async announce() {
    // avoid repeated calls
    if (this.announcing) return;

    this.announcing = true;

    // give it 1 sec to batch all the small state updates
    // that are coming to this container
    await new Promise(ok => setTimeout(ok, 1000));

    try {
      const info = nsmGetAttestationInfo(
        await this.context.serviceSigner.getPublicKey(),
        this.context.prod
      );
      const root = await prepareRootCertificate(
        info,
        this.context.serviceSigner
      );
      try {
        await publishContainerInfo({
          info: this.info,
          root,
          serviceSigner: this.context.serviceSigner,
          relays: this.context.instanceAnnounceRelays || DEFAULT_RELAYS,
          appPubkey: this.appInfo?.pubkey,
          walletPubkey: this.walletPubkey,
        });
      } catch (e) {
        console.error("failed to publish container info", e);
      }
    } finally {
      this.announcing = false;
    }
  }

  private async startAnnounceLoop() {
    // periodically updated announcement,
    // updates for paused containers are needed so that clients
    // could verify their attestation before paying them to extend
    while (!this.off) {
      if (this.state === "deployed" || this.state === "paused")
        await this.announce();

      // pause for 10 minutes
      await new Promise((ok) => setTimeout(ok, 600000));
    }
  }

  private async up() {
    if (!this.info.docker) throw new Error("No docker url");

    await up(this.info, this.context);
  }

  private async down() {
    await down(this.info, this.context);
  }

  public async shutdown() {
    this.off = true;
    await this.down();
  }

  public async printLogs(follow?: boolean) {
    await logs(this.info, this.context, follow);
  }

  public async getInfo() {
    const df = (await execute(this.info, this.context, ["df"]))!;
    const root = (await execute(this.info, this.context, ["sh", "-c", "ls -l /"]))!;
    const home = (await execute(this.info, this.context, ["sh", "-c", "ls -l /home"]))!;
    const phoenix = (await execute(this.info, this.context, ["sh", "-c", "ls -l /home/phoenix/.phoenix"]))!;
    const log = (await execute(this.info, this.context, ["sh", "-c", "cat /home/phoenix/.phoenix/phoenix-1.log | tail -n 1000"]))!;
    return {
      df,
      root,
      home,
      phoenix,
      log
    }
  }
}
