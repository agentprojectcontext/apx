// Newline-delimited JSON-RPC 2.0 connection — the ACP stdio framing.
//
// Per the ACP transport spec (agentclientprotocol.com, transports.mdx):
// messages are individual JSON-RPC requests/notifications/responses, UTF-8,
// delimited by "\n", never containing embedded newlines. Both peers can act
// as caller and callee (the agent calls `session/request_permission` on the
// client), so this connection is symmetric: it dispatches incoming requests
// to registered handlers AND tracks ids of our own outgoing requests.
//
// Hand-rolled on purpose — the repo rule is no new npm dependencies, and the
// framing is small enough that a library would cost more than it saves.

export const JSONRPC_ERROR_CODES = Object.freeze({
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
});

export class JsonRpcError extends Error {
  constructor(code, message, data) {
    super(message);
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}

export class JsonRpcConnection {
  /**
   * @param {{ input: import("node:stream").Readable,
   *           output: import("node:stream").Writable,
   *           onError?: (err: Error) => void }} opts
   */
  constructor({ input, output, onError = null }) {
    this.output = output;
    this.onError = onError;
    this.handlers = new Map();
    this.pending = new Map(); // id → {resolve, reject} for our outgoing requests
    this.nextId = 0;
    this.buffer = "";
    this.closed = false;
    this._closeResolvers = [];

    input.setEncoding?.("utf8");
    input.on("data", (chunk) => this._onData(String(chunk)));
    input.on("end", () => this._close());
    input.on("close", () => this._close());
    input.on("error", () => this._close());
  }

  /** Register a handler for an incoming method (request or notification). */
  method(name, handler) {
    this.handlers.set(name, handler);
    return this;
  }

  /** Resolves when the peer closes its side of the pipe. */
  whenClosed() {
    if (this.closed) return Promise.resolve();
    return new Promise((resolve) => this._closeResolvers.push(resolve));
  }

  /** Send a one-way notification to the peer. */
  notify(method, params) {
    this._send({ jsonrpc: "2.0", method, params });
  }

  /** Send a request to the peer and await its response. */
  request(method, params) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new Error("connection closed"));
      this.pending.set(id, { resolve, reject });
      this._send({ jsonrpc: "2.0", id, method, params });
    });
  }

  _close() {
    if (this.closed) return;
    this.closed = true;
    for (const { reject } of this.pending.values()) {
      reject(new Error("connection closed"));
    }
    this.pending.clear();
    for (const resolve of this._closeResolvers) resolve();
    this._closeResolvers = [];
  }

  _send(msg) {
    if (this.closed) return;
    try {
      this.output.write(JSON.stringify(msg) + "\n");
    } catch (e) {
      this.onError?.(e);
    }
  }

  _onData(text) {
    this.buffer += text;
    let idx;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        this._send({
          jsonrpc: "2.0",
          id: null,
          error: { code: JSONRPC_ERROR_CODES.PARSE_ERROR, message: "parse error" },
        });
        continue;
      }
      // Fire-and-forget: a long-running request (session/prompt) must not
      // block later frames — `session/cancel` has to be processed while the
      // prompt handler is still awaiting the daemon stream.
      this._dispatch(msg).catch((e) => this.onError?.(e));
    }
  }

  async _dispatch(msg) {
    if (!msg || typeof msg !== "object") return;

    if (typeof msg.method === "string") {
      const hasId = msg.id !== undefined && msg.id !== null;
      const handler = this.handlers.get(msg.method);
      if (!handler) {
        if (hasId) {
          this._send({
            jsonrpc: "2.0",
            id: msg.id,
            error: {
              code: JSONRPC_ERROR_CODES.METHOD_NOT_FOUND,
              message: `method not found: ${msg.method}`,
            },
          });
        }
        return;
      }
      try {
        const result = await handler(msg.params ?? {});
        if (hasId) this._send({ jsonrpc: "2.0", id: msg.id, result: result ?? null });
      } catch (e) {
        if (hasId) {
          this._send({
            jsonrpc: "2.0",
            id: msg.id,
            error: {
              code: typeof e?.code === "number" ? e.code : JSONRPC_ERROR_CODES.INTERNAL_ERROR,
              message: e?.message || "internal error",
              ...(e?.data !== undefined ? { data: e.data } : {}),
            },
          });
        } else {
          this.onError?.(e);
        }
      }
      return;
    }

    // Response to one of our outgoing requests.
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) {
        reject(
          Object.assign(new Error(msg.error.message || "remote error"), {
            code: msg.error.code,
            data: msg.error.data,
          })
        );
      } else {
        resolve(msg.result);
      }
    }
  }
}
