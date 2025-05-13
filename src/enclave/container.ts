import { up, logs, down } from "../docker";
import { DBContainer } from "../db";
import { prepareRootCertificate, publishContainerInfo } from "../nostr";
import { PrivateKeySigner } from "../signer";
import { Signer } from "../types";
import { nsmGetAttestationInfo } from "../nsm";

export interface ContainerContext {
  dir: string;
  prod: boolean;
  serviceSigner: Signer;
  relays: string[];
  contEndpoint: string;
}

export class Container {
  private context: ContainerContext;
  info: DBContainer;

  constructor(info: DBContainer, context: ContainerContext) {
    this.info = info;
    this.context = context;
  }

  setDeployed(d: boolean) {
    if (d && !this.info.deployed) this.startAnnouncing();
    this.info.deployed = d;
  }

  private async startAnnouncing() {
    const announce = async () => {
      const info = nsmGetAttestationInfo(
        await this.context.serviceSigner.getPublicKey(),
        this.context.prod
      );
      const root = await prepareRootCertificate(
        info,
        this.context.serviceSigner
      );
      await publishContainerInfo({
        info: this.info,
        root,
        serviceSigner: this.context.serviceSigner,
        relays: this.context.relays,
      });
    };

    await announce();
    setInterval(announce, 600000);
  }

  async up() {
    if (!this.info.docker) throw new Error("No docker url");

    await up(this.info, this.context);

    if (this.info.deployed) this.startAnnouncing();
  }

  async down() {
    await down(this.info, this.context);
  }

  async printLogs(follow?: boolean) {
    await logs(this.info, this.context, follow);
  }
}
