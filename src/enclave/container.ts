import { up, logs, down } from "../modules/docker";
import { ContainerState, DBContainer } from "../modules/db";
import { prepareRootCertificate, publishContainerInfo } from "../modules/nostr";
import { nsmGetAttestationInfo } from "../modules/nsm";
import { PrivateKeySigner } from "../modules/signer";

export interface ContainerContext {
  dir: string;
  prod: boolean;
  serviceSigner: PrivateKeySigner;
  relays: string[];
  contEndpoint: string;
}

export class Container {
  private context: ContainerContext;
  info: DBContainer;
  appInfo?: any;
  announcing: boolean = false;

  constructor(info: DBContainer, context: ContainerContext) {
    this.info = info;
    this.context = context;
  }

  setState(s: ContainerState) {
    if (s !== "waiting") this.ensureAnnouncing();
    this.info.state = s;
  }

  private async ensureAnnouncing() {
    if (!this.announcing) return;

    this.announcing = true;

    const announce = async () => {
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
          relays: this.context.relays,
        });  
      } catch (e) {
        console.error("failed to publish container info", e);
      }
    };

    await announce();

    setInterval(announce, 600000);
  }

  async up() {
    if (!this.info.docker) throw new Error("No docker url");

    await up(this.info, this.context);

    this.ensureAnnouncing();
  }

  async down() {
    await down(this.info, this.context);
  }

  async printLogs(follow?: boolean) {
    await logs(this.info, this.context, follow);
  }
}
