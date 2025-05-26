import { IncomingHttpHeaders } from "http";
import { Rep, Req, WSServer } from "../modules/ws-server";
import { AppServer } from "./app-server";
import { WebSocket } from "ws";
import { nsmGetAttestationInfo } from "../modules/nsm";
import {
  prepareAppCert,
  prepareContainerCert,
  prepareRootCertificate,
} from "../modules/nostr";
import { CHARGE_INTERVAL, SATS_PER_UNIT_PER_INTERVAL } from "../modules/consts";

export class ContainerServer extends WSServer {
  private server: AppServer;

  constructor(port: number, server: AppServer) {
    super(port);
    this.server = server;
  }

  private getContainer(headers?: IncomingHttpHeaders) {
    const token = headers?.["token"] as string;
    return this.server.getContainerByToken(token);
  }

  protected checkHeaders(ws: WebSocket, headers: IncomingHttpHeaders) {
    return !!this.getContainer(headers);
  }

  private async createCertificate(
    req: Req,
    rep: Rep,
    headers?: IncomingHttpHeaders
  ) {
    if (!req.params.pubkey) throw new Error("No pubkey for certificate");
    const pubkey = req.params.pubkey;

    const info = nsmGetAttestationInfo(
      await this.server.getContext().serviceSigner.getPublicKey(),
      this.server.getContext().prod
    );
    const root = await prepareRootCertificate(
      info,
      this.server.getContext().serviceSigner
    );

    const cont = this.getContainer(headers);
    const contCert = await prepareContainerCert({
      info: cont!.info,
      serviceSigner: this.server.getContext().serviceSigner,
    });

    const appCert = await prepareAppCert({
      info: cont!.info,
      appPubkey: pubkey,
    });

    rep.result = {
      root,
      certs: [contCert, appCert],
    };
  }

  private async setInfo(req: Req, rep: Rep, headers?: IncomingHttpHeaders) {
    if (!req.params.info) throw new Error("No info for set_info");

    const info = req.params.info;
    const cont = this.getContainer(headers);
    await this.server.setContainerAppInfo(cont!, info);

    rep.result = {
      ok: true,
    };
  }

  private async getContainerInfo(
    req: Req,
    rep: Rep,
    headers?: IncomingHttpHeaders
  ) {
    const cont = this.getContainer(headers);
    if (!cont) throw new Error("Invalid token");

    rep.result = {
      ok: true,
      container: {
        pubkey: cont.info.pubkey,
        balance: cont.info.balance,
        uptimeCount: cont.info.uptimeCount,
        uptimePaid: cont.info.uptimePaid,
        units: cont.info.units,
        price: cont.info.units * SATS_PER_UNIT_PER_INTERVAL * 1000,
        interval: CHARGE_INTERVAL,
        walletPubkey: cont.walletPubkey,
      },
    };
  }

  protected async handle(req: Req, rep: Rep, headers?: IncomingHttpHeaders) {
    if (req.method === "create_certificate") {
      await this.createCertificate(req, rep, headers);
    } else if (req.method === "set_info") {
      await this.setInfo(req, rep, headers);
    } else if (req.method === "get_container_info") {
      await this.getContainerInfo(req, rep, headers);
    }
  }
}
