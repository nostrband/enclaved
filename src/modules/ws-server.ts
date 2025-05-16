import { IncomingHttpHeaders } from "http";
import { RawData, WebSocket, WebSocketServer } from "ws";

export interface Req {
  id: string;
  method: string;
  params: any;
}

export interface Rep {
  id: string;
  result: any;
  error?: string;
}

export class WSServer {
  private wss: WebSocketServer;
  private headers = new Map<WebSocket, IncomingHttpHeaders>();

  constructor(port: number) {
    this.wss = new WebSocketServer({ port });
    this.wss.on("connection", this.onConnect.bind(this));
  }

  protected checkHeaders(ws: WebSocket, headers: IncomingHttpHeaders): boolean {
    return true;
  }

  protected onConnected(ws: WebSocket) {
    // noop
  }

  private onConnect(ws: WebSocket, req: any) {
    console.log("connect", req.headers);
    if (!this.checkHeaders(ws, req.headers)) {
      // drop
      ws.close();
      return;
    }

    this.headers.set(ws, req.headers);
    ws.on("error", console.error);
    ws.on("close", () => this.headers.delete(ws));
    ws.on("message", (data) => this.onMessage(ws, data));

    this.onConnected(ws);
  }

  protected async handle(req: Req, rep: Rep, headers?: IncomingHttpHeaders) {
    throw new Error("Not implemented " + req.method);
  }

  private async onMessage(ws: WebSocket, data: RawData) {
    console.log("received: %s", data);
    let rep: Rep | undefined;
    try {
      const req = JSON.parse(data.toString("utf8"));
      console.log("req", req);
      rep = {
        id: req.id,
        result: "",
      };
      const headers = this.headers.get(ws);
      await this.handle(req, rep, headers);
    } catch (e: any) {
      console.log("Bad req", e, data.toString("utf8"));
      if (rep) rep.error = e.message || e.toString();
    }
    console.log("rep", JSON.stringify(rep));

    try {
      if (rep) {
        ws.send(JSON.stringify(rep));
      } else {
        ws.close();
      }
    } catch (e) {
      console.log("failed to send reply", rep, e);
    }
  }
}
