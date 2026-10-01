// JSON-RPC 2.0 over a child's stdio, one message per line: the wire under the Agent Client Protocol.
import type { ChildProcessWithoutNullStreams } from "node:child_process";

type Pending = { resolve(v: unknown): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> };

export class RpcError extends Error {
  readonly code: number;
  readonly data: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.data = data;
  }
}

/** What the other side asks us (permissions, files): answer with a result, or throw an RpcError. */
export type RequestHandler = (method: string, params: unknown) => Promise<unknown>;

export function connect(
  child: ChildProcessWithoutNullStreams,
  on: { request: RequestHandler; notification(method: string, params: unknown): void },
) {
  let nextId = 0;
  let buf = "";
  let closed: Error | undefined;
  const pending = new Map<number, Pending>();
  const write = (msg: object) => {
    if (!closed) child.stdin.write(`${JSON.stringify(msg)}\n`);
  };

  const fail = (err: Error) => {
    closed ??= err;
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    pending.clear();
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buf += chunk;
    for (let n = buf.indexOf("\n"); n >= 0; n = buf.indexOf("\n")) {
      const line = buf.slice(0, n).trim();
      buf = buf.slice(n + 1);
      if (!line) continue;
      let msg: {
        id?: number | string;
        method?: string;
        params?: unknown;
        result?: unknown;
        error?: { code: number; message: string; data?: unknown };
      };
      try {
        msg = JSON.parse(line);
      } catch {
        // Some agents log to stdout; anything that is not a message is not ours to read.
        continue;
      }
      if (msg.method !== undefined && msg.id !== undefined) {
        const id = msg.id;
        on.request(msg.method, msg.params).then(
          (result) => write({ jsonrpc: "2.0", id, result: result ?? null }),
          (err: unknown) =>
            write({
              jsonrpc: "2.0",
              id,
              error:
                err instanceof RpcError
                  ? { code: err.code, message: err.message }
                  : { code: -32603, message: err instanceof Error ? err.message : String(err) },
            }),
        );
      } else if (msg.method !== undefined) on.notification(msg.method, msg.params);
      else if (typeof msg.id === "number") {
        const p = pending.get(msg.id);
        if (!p) continue;
        pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new RpcError(msg.error.code, msg.error.message, msg.error.data));
        else p.resolve(msg.result);
      }
    }
  });
  child.on("exit", (code, signal) => fail(new Error(`the agent process exited (${signal ?? code})`)));
  child.on("error", (err) => fail(err));

  return {
    request<T>(method: string, params: unknown, timeoutMs: number): Promise<T> {
      if (closed) return Promise.reject(closed);
      const id = ++nextId;
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} took longer than ${Math.round(timeoutMs / 1000)}s`));
        }, timeoutMs);
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
        write({ jsonrpc: "2.0", id, method, params });
      });
    },
    notify(method: string, params: unknown): void {
      write({ jsonrpc: "2.0", method, params });
    },
  };
}

export type Rpc = ReturnType<typeof connect>;
