// Client SDK used by terminal, web, desktop, mobile and nodes. Uses only web-standard
// fetch/WebSocket so the same file runs in Node 24, browsers, Electron and React Native.
import {
  type Actor,
  type ApxErrorShape,
  type ClientRole,
  type EventFrame,
  PROTOCOL_VERSION,
  ServerFrame,
  type WelcomeFrame,
} from "./frames.ts";
import { type MethodName, methods, type Params, type Result } from "./methods.ts";

export class ApxError extends Error {
  readonly code: ApxErrorShape["code"];
  readonly detail: unknown;
  readonly retryable: boolean;
  constructor(shape: ApxErrorShape) {
    super(shape.message);
    this.name = "ApxError";
    this.code = shape.code;
    this.detail = shape.detail;
    this.retryable = shape.retryable ?? false;
  }
}

/** Methods whose server deadline exceeds the default: the client must wait longer than the server (rule 9). */
function clientDeadline(method: string, params: unknown, fallback: number): number {
  if (method === "browser.handoff") return ((params as { timeout_s?: number })?.timeout_s ?? 300) * 1000 + 20_000;
  if (method === "browser.import_cookies") return 130_000;
  if (method === "system.import_v1") return 60_000;
  // An update installs dependencies and builds the panel; a check fetches from the remote.
  if (method === "system.update") return 25 * 60_000;
  if (method === "system.updates") return 120_000;
  // A tool called by an external harness can run as long as the longest tool (ask_owner waits up to 16 min).
  if (method === "harness.call") return 17 * 60_000;
  // Listing models may start each agent CLI to ask it.
  if (method === "models.list") return 150_000;
  // Summarizing waits on an auxiliary model call of up to 90 s.
  if (method === "threads.compact") return 120_000;
  // A homelab GPU may queue an image for minutes (the server gives up at 11); speech at 2.
  if (method === "media.image") return 12 * 60_000;
  if (method === "media.speak") return 150_000;
  // Indexing every note by meaning may take a while on a local model.
  if (method === "memory.reindex") return 10 * 60_000;
  if (method === "runs.wait") return ((params as { timeout_s?: number })?.timeout_s ?? 60) * 1000 + 10_000;
  return fallback;
}

export type ClientOptions = {
  /** Base URL of the core, e.g. http://127.0.0.1:7440 */
  url: string;
  token?: string;
  client?: { name: string; version: string };
  timeoutMs?: number;
  /** "agent" for clients driven by a model (e.g. `apx2 mcp`): they never get the human's controls. */
  actor?: Actor;
  /** An outside app's client token (clients.create): it acts as a model, limited to its scopes. */
  clientToken?: string;
};

export class ApxClient {
  readonly #opts: Required<Omit<ClientOptions, "token" | "clientToken">> & { token?: string; clientToken?: string };

  constructor(opts: ClientOptions) {
    this.#opts = {
      client: { name: "apx-client", version: "0.0.0" },
      timeoutMs: 15_000,
      actor: "human",
      ...opts,
      url: opts.url.replace(/\/$/, ""),
    };
  }

  /** Request/response over HTTP. Same handlers as the socket: POST /rpc/<method>. */
  async call<M extends MethodName>(method: M, params: Params<M>, idem?: string): Promise<Result<M>> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.#opts.token) headers.authorization = `Bearer ${this.#opts.token}`;
    if (this.#opts.actor === "agent") headers["x-apx-actor"] = "agent";
    if (this.#opts.clientToken) headers["x-apx-client"] = this.#opts.clientToken;
    const key = idem ?? (methods[method].effect ? crypto.randomUUID() : undefined);
    if (key) headers["idempotency-key"] = key;
    const res = await fetch(`${this.#opts.url}/rpc/${method}`, {
      method: "POST",
      headers,
      body: JSON.stringify(params ?? {}),
      signal: AbortSignal.timeout(clientDeadline(method, params, this.#opts.timeoutMs)),
    });
    const body = (await res.json()) as { ok: boolean; result?: unknown; error?: ApxErrorShape };
    if (!body.ok || body.error) {
      throw new ApxError(body.error ?? { code: "internal", message: `HTTP ${res.status}` });
    }
    return methods[method].result.parse(body.result) as Result<M>;
  }

  /** Opens a live socket (hello → welcome), then req/res + events over one connection. */
  async connect(role: ClientRole = "operator", caps: string[] = []): Promise<ApxSocket> {
    const token = this.#opts.token ? `?token=${encodeURIComponent(this.#opts.token)}` : "";
    const wsUrl = `${this.#opts.url.replace(/^http/, "ws")}/ws${token}`;
    const socket = new ApxSocket(wsUrl, this.#opts.timeoutMs);
    await socket.open({
      t: "hello",
      protocol: PROTOCOL_VERSION,
      client: this.#opts.client,
      role,
      caps,
      actor: this.#opts.actor,
    });
    return socket;
  }
}

export type RequestHandler = (method: string, params: unknown) => Promise<unknown>;

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

export class ApxSocket {
  #ws: WebSocket | undefined;
  #seq = 0;
  #pending = new Map<string, Pending>();
  #listeners = new Set<(event: EventFrame) => void>();
  #handler: RequestHandler | undefined;
  #eventSeq = 0;
  welcome: WelcomeFrame | undefined;
  readonly url: string;
  readonly timeoutMs: number;

  constructor(url: string, timeoutMs: number) {
    this.url = url;
    this.timeoutMs = timeoutMs;
  }

  open(hello: unknown): Promise<WelcomeFrame> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.#ws = ws;
      const timer = setTimeout(() => reject(new Error("welcome timeout")), this.timeoutMs);
      ws.addEventListener("open", () => ws.send(JSON.stringify(hello)));
      ws.addEventListener("error", () => reject(new Error(`socket error: ${this.url}`)));
      ws.addEventListener("close", () => {
        clearTimeout(timer);
        if (!this.welcome) reject(new Error("socket closed before welcome"));
        this.#failAll(new Error("socket closed"));
      });
      ws.addEventListener("message", (msg) => {
        const frame = ServerFrame.safeParse(JSON.parse(String(msg.data)));
        if (!frame.success) return;
        const f = frame.data;
        if (f.t === "welcome") {
          clearTimeout(timer);
          this.welcome = f;
          resolve(f);
        } else if (f.t === "res") {
          const p = this.#pending.get(f.id);
          if (!p) return;
          this.#pending.delete(f.id);
          clearTimeout(p.timer);
          if (f.ok) p.resolve(f.result);
          else p.reject(new ApxError(f.error));
        } else if (f.t === "req") {
          void this.#serve(f.id, f.method, f.params);
        } else {
          for (const l of this.#listeners) l(f);
        }
      });
    });
  }

  async call<M extends MethodName>(method: M, params: Params<M>, idem?: string): Promise<Result<M>> {
    const ws = this.#ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error("socket not open");
    const id = `r${++this.#seq}`;
    const raw = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.#pending.delete(id);
          reject(new ApxError({ code: "timeout", message: `${method} timed out` }));
        },
        clientDeadline(method, params, this.timeoutMs),
      );
      this.#pending.set(id, { resolve, reject, timer });
      const key = idem ?? (methods[method].effect ? crypto.randomUUID() : undefined);
      ws.send(JSON.stringify({ t: "req", id, method, params, idem: key }));
    });
    return methods[method].result.parse(raw) as Result<M>;
  }

  /** Node role: answer requests the core sends to this client (e.g. browser.* for a "browser" node). */
  onRequest(handler: RequestHandler): void {
    this.#handler = handler;
  }

  /** Node role: push an event (tab updated, control changed…). */
  emit(stream: string, type: string, payload: unknown): void {
    this.#ws?.send(JSON.stringify({ t: "event", stream, seq: ++this.#eventSeq, type, payload }));
  }

  get closed(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.#ws || this.#ws.readyState === WebSocket.CLOSED) resolve();
      else this.#ws.addEventListener("close", () => resolve(), { once: true });
    });
  }

  async #serve(id: string, method: string, params: unknown): Promise<void> {
    let body: object;
    if (!this.#handler) {
      body = { ok: false, error: { code: "unknown_method", message: `client does not serve ${method}` } };
    } else {
      try {
        body = { ok: true, result: await this.#handler(method, params) };
      } catch (err) {
        body = {
          ok: false,
          error:
            err instanceof ApxError
              ? { code: err.code, message: err.message }
              : { code: "internal", message: err instanceof Error ? err.message : String(err) },
        };
      }
    }
    this.#ws?.send(JSON.stringify({ t: "res", id, ...body }));
  }

  onEvent(listener: (event: EventFrame) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  close(): void {
    this.#ws?.close();
  }

  #failAll(err: Error): void {
    for (const p of this.#pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.#pending.clear();
  }
}
