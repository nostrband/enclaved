import { Event } from "nostr-tools";
import { now } from "./utils";
import { KIND_ENCLAVED_RPC } from "./consts";
import { Signer } from "./types";

export interface Request {
  pubkey: string;
  id: string;
  method: string;
  params: any;
}

export interface Reply {
  id: string;
  result?: any;
  error?: string;
}

export class EnclavedServer {
  private signer: Signer;
  private done = new Set<string>();

  constructor(signer: Signer) {
    this.signer = signer;
  }

  public getSigner() {
    return this.signer;
  }

  protected async ping(req: Request, res: Reply) {
    res.id = req.id;
    res.result = "pong";
  }

  protected async launch(req: Request, res: Reply) {
    throw new Error("Method not implemented");
  }

  private async handle(req: Request, res: Reply) {
    switch (req.method) {
      case "ping":
        return this.ping(req, res);
      case "launch":
        return this.launch(req, res);
      default:
        throw new Error("Invalid method");
    }
  }

  private isValidReq(req: Request) {
    let valid = false;
    switch (req.method) {
      // case "pay_invoice":
      //   valid = !!req.params.invoice && typeof req.params.invoice === "string";
      //   break;
      // case "make_invoice":
      //   valid = !!req.params.amount && typeof req.params.amount === "number";
      //   break;
      // case "make_invoice_for":
      //   valid =
      //     !!req.params.amount &&
      //     typeof req.params.amount === "number" &&
      //     !!req.params.pubkey &&
      //     typeof req.params.pubkey === "string" &&
      //     req.params.pubkey.length === 64;
      //   break;
      // case "list_transactions":
      //   valid = true;
      //   break;
      // case "get_balance":
      //   valid = true;
      //   break;
      // case "get_info":
      //   valid = true;
      //   break;
      default:
        valid = true;
    }

    return valid;
  }

  // process event tagging pubkey
  public async process(e: Event): Promise<Event | undefined> {
    if (e.kind !== KIND_ENCLAVED_RPC) return; // ignore irrelevant kinds
    if (this.done.has(e.id)) return;
    this.done.add(e.id);

    const res: Reply = {
      id: "",
    };

    try {
      const data = await this.signer.nip44Decrypt(e.pubkey, e.content);
      const { id, method, params } = JSON.parse(data);
      if (!id || !method || !params) throw new Error("Bad request");

      // req
      const req: Request = {
        pubkey: e.pubkey,
        id: e.id,
        method,
        params,
      };
      console.log(new Date(), "request", req);

      // res
      res.id = id;

      if (!this.isValidReq(req)) throw new Error("Invalid request");

      await this.handle(req, res);
      console.log(new Date(), "processed", req, res);
    } catch (err: any) {
      console.log("Bad event ", err, e);
      res.error = err.message || err.toString();
    }

    console.log(new Date(), "reply", res);
    return this.signer.signEvent({
      pubkey: await this.signer.getPublicKey(),
      kind: KIND_ENCLAVED_RPC,
      created_at: now(),
      tags: [["p", e.pubkey]],
      content: await this.signer.nip44Encrypt(e.pubkey, JSON.stringify(res)),
    });
  }
}
