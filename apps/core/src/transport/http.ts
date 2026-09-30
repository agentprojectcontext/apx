import type { IncomingMessage, ServerResponse } from "node:http";
import type { Log } from "../log.ts";
import type { Dispatch } from "../rpc/router.ts";

const MAX_BODY = 1024 * 1024;

export function httpHandler(dispatch: Dispatch, log: Log, token: string | undefined) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://core");
    if (req.method === "GET" && url.pathname === "/health") {
      return send(
        res,
        200,
        await dispatch("system.health", {}, { transport: "http", role: "operator", session: undefined, log }),
      );
    }
    if (req.method === "POST" && url.pathname.startsWith("/rpc/")) {
      if (token && req.headers.authorization !== `Bearer ${token}`) {
        return send(res, 401, { ok: false, error: { code: "unauthorized", message: "missing or bad token" } });
      }
      let body: unknown;
      try {
        body = await readJson(req);
      } catch (err) {
        return send(res, 400, { ok: false, error: { code: "bad_request", message: String(err) } });
      }
      const idem = header(req, "idempotency-key");
      const out = await dispatch(
        url.pathname.slice(5),
        body,
        { transport: "http", role: "operator", session: undefined, log },
        idem,
      );
      return send(res, out.ok ? 200 : statusFor(out.error.code), out);
    }
    send(res, 404, { ok: false, error: { code: "bad_request", message: "not found" } });
  };
}

function statusFor(code: string): number {
  return code === "unknown_method" ? 404 : code === "bad_request" ? 400 : code === "unauthorized" ? 401 : 500;
}

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}
