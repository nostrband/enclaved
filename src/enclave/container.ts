import { launch, logs, stop } from "../compose";
import { DBContainer } from "../db";
import { publishContainerInfo } from "../nostr";
import { PrivateKeySigner } from "../signer";
import { Signer } from "../types";

export interface ContainerContext {
  dir: string;
  prod: boolean;
  serviceSigner: Signer;
  relays: string[];
}

export class Container {
  private context: ContainerContext;
  info: DBContainer;
 
  constructor(info: DBContainer, context: ContainerContext) {
    this.info = info;
    this.context = context;
    if (this.info.deployed) this.startAnnouncing();
  }

  setDeployed(d: boolean) {
    if (d && !this.info.deployed) this.startAnnouncing();
    this.info.deployed = d;
  }

  private async startAnnouncing() {
    const announce = async () => {
      await publishContainerInfo({
        info: this.info,
        serviceSigner: this.context.serviceSigner,
        containerSigner: new PrivateKeySigner(this.info.seckey),
        relays: this.context.relays,
      });      
    };

    await announce();
    setInterval(announce, 600000);  
  }

  async launch() {
    if (!this.info.docker) throw new Error("No docker url");

    await launch({
      docker: this.info.docker,
      env: this.info.env,
      units: this.info.units,
      dir: this.context.dir,
      key: this.info.seckey,
      prod: this.context.prod,
    });
  }

  async stop() {
    await stop(this.context.dir, this.info.pubkey);
  }

  async printLogs() {
    await logs(this.context.dir, this.info.pubkey);
  }

}