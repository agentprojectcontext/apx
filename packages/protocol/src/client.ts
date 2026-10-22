// Client SDK used by terminal, web, desktop, mobile and nodes. Uses only web-standard
// fetch/WebSocket so the same file runs in Node 24, browsers, Electron and React Native.
// It holds no zod: the core validates params and results, so a browser never downloads the schema registry.

import { PROTOCOL_VERSION } from "./constants.ts";
import type { Actor, ApxErrorShape, ClientRole, EventFrame, ServerFrame, WelcomeFrame } from "./frames.ts";
import type { MethodName, Params, Result } from "./methods.ts";
import { secureRequestKey } from "./request-key.ts";

export {
  AGENT_NAMES,
  ARTIFACT_FILE_EXT,
  DOCUMENT_MAX_BYTES,
  ErrorCode,
  PERSON_RELATIONS,
  PROTOCOL_VERSION,
  pairingLink,
  randomAgentName,
  SURFACE_STATE_MAX,
  UPLOAD_LIMITS,
} from "./constants.ts";

export { secureRequestKey } from "./request-key.ts";

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
  if (method === "mcp.call") return 180_000;
  if (method === "mcp.describe" || method === "mcp.tools" || method === "mcp.test" || method === "mcp.signIn")
    return 45_000;
  if (method === "system.import_v1") return 60_000;
  // Importing skills may clone a repository (the server gives up at 60 s).
  if (method === "skills.preview" || method === "skills.import") return 90_000;
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
  if (method === "media.transcribe") return 190_000;
  // Base64 uploads need time to cross a slow connection to a remote core.
  if (method === "media.upload") return 120_000;
  // A widget's video can be 15 MB, base64 over a slow link to a remote core.
  if (method === "surfaces.media") return 120_000;
  // An artifact's fetch waits up to 30 s on the outside API; a bundle may carry a 50 MB database.
  if (method === "surfaces.fetch") return 45_000;
  if (method === "surfaces.export" || method === "surfaces.import") return 180_000;
  // Indexing every note by meaning may take a while on a local model.
  if (method === "memory.reindex") return 10 * 60_000;
  // Listing reads every session's head; importing copies whole histories and their images.
  if (method === "sessions.projects") return 60_000;
  if (method === "sessions.import") return 5 * 60_000;
  // A long chat is read in stretches by the auxiliary model; the server stops taking notes at 8 min.
  if (method === "sessions.digest") return 11 * 60_000;
  // The owner's phone is asked again under each of a chat's addresses, then each file is downloaded (server: 150 s).
  if (method === "channels.recover") return 170_000;
  if (method === "runs.wait") return ((params as { timeout_s?: number })?.timeout_s ?? 60) * 1000 + 10_000;
  return fallback;
}

export type ClientOptions = {
  /** Base URL of the core, e.g. http://127.0.0.1:7440 */
  url: string;
  token?: string;
  client?: { name: string; version: string };
  timeoutMs?: number;
  /** Native runtimes inject their secure UUID source instead of a browser crypto global. */
  requestKey?: () => string;
  /** "agent" for clients driven by a model (e.g. `apx mcp`): they never get the human's controls. */
  actor?: Actor;
  /** An outside app's client token (clients.create): it acts as a model, limited to its scopes. */
  clientToken?: string;
  /** Cancels calls and live sockets of this client, on top of each call's own deadline. */
  signal?: AbortSignal;
};

export class ApxClient {
  readonly #opts: Required<Omit<ClientOptions, "token" | "clientToken" | "signal">> & {
    token?: string;
    clientToken?: string;
    signal?: AbortSignal;
  };

  constructor(opts: ClientOptions) {
    this.#opts = {
      client: { name: "apx-client", version: "0.0.0" },
      timeoutMs: 15_000,
      actor: "human",
      requestKey: secureRequestKey,
      ...opts,
      url: opts.url.replace(/\/$/, ""),
    };
  }

  /** The same client, its calls also cancelled by `signal` (a console aborting the command it is waiting on). */
  withSignal(signal: AbortSignal): ApxClient {
    return new ApxClient({
      ...this.#opts,
      signal: this.#opts.signal ? AbortSignal.any([this.#opts.signal, signal]) : signal,
    });
  }

  /** Request/response over HTTP. Same handlers as the socket: POST /rpc/<method>. */
  async call<M extends MethodName>(method: M, params: Params<M>, idem?: string): Promise<Result<M>> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.#opts.token) headers.authorization = `Bearer ${this.#opts.token}`;
    if (this.#opts.actor === "agent") headers["x-apx-actor"] = "agent";
    if (this.#opts.clientToken) headers["x-apx-client"] = this.#opts.clientToken;
    // Every call carries a key: the core uses it only for methods with effects, so the client needs no registry.
    headers["idempotency-key"] = idem ?? this.#opts.requestKey();
    const deadline = AbortSignal.timeout(clientDeadline(method, params, this.#opts.timeoutMs));
    const url = `${this.#opts.url}/rpc/${method}`;
    const request = {
      method: "POST",
      headers,
      body: JSON.stringify(params ?? {}),
      signal: this.#opts.signal ? AbortSignal.any([this.#opts.signal, deadline]) : deadline,
    };
    let res: Response;
    try {
      res = await fetch(url, request);
    } catch (error) {
      const code = (error as { cause?: { code?: unknown } } | undefined)?.cause?.code;
      // Only a chat read is safe to repeat here; effects and one-time results must never be replayed.
      if (method !== "threads.get" || request.signal.aborted || (code !== "ECONNRESET" && code !== "UND_ERR_SOCKET"))
        throw error;
      res = await fetch(url, request);
    }
    const body = (await res.json()) as { ok: boolean; result?: unknown; error?: ApxErrorShape };
    if (!body.ok || body.error) {
      throw new ApxError(body.error ?? { code: "internal", message: `HTTP ${res.status}` });
    }
    return body.result as Result<M>;
  }

  /** Opens a live socket (hello → welcome), then req/res + events over one connection. */
  async connect(role: ClientRole = "operator", caps: string[] = []): Promise<ApxSocket> {
    const signal = this.#opts.signal;
    signal?.throwIfAborted();
    const token = this.#opts.token ? `?token=${encodeURIComponent(this.#opts.token)}` : "";
    const wsUrl = `${this.#opts.url.replace(/^http/, "ws")}/ws${token}`;
    const socket = new ApxSocket(wsUrl, this.#opts.timeoutMs, this.#opts.requestKey);
    const abort = () => socket.close();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      await socket.open({
        t: "hello",
        protocol: PROTOCOL_VERSION,
        client: this.#opts.client,
        role,
        caps,
        actor: this.#opts.actor,
      });
      signal?.throwIfAborted();
      void socket.closed.then(() => signal?.removeEventListener("abort", abort));
      return socket;
    } catch (error) {
      signal?.removeEventListener("abort", abort);
      socket.close();
      signal?.throwIfAborted();
      throw error;
    }
  }
}

const FRAME_TYPES = new Set(["welcome", "req", "res", "event"]);

/** The frame's kind is checked, not its whole shape: the core is the side that validates. */
function parseFrame(data: string): ServerFrame | undefined {
  try {
    const f = JSON.parse(data) as { t?: unknown };
    return f && typeof f === "object" && FRAME_TYPES.has(f.t as string) ? (f as ServerFrame) : undefined;
  } catch {
    return undefined;
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
  readonly #requestKey: () => string;

  constructor(url: string, timeoutMs: number, requestKey = secureRequestKey) {
    this.url = url;
    this.timeoutMs = timeoutMs;
    this.#requestKey = requestKey;
  }

  open(hello: unknown): Promise<WelcomeFrame> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.#ws = ws;
      const timer = setTimeout(() => {
        reject(new Error("welcome timeout"));
        ws.close();
      }, this.timeoutMs);
      ws.addEventListener("open", () => ws.send(JSON.stringify(hello)));
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("socket error"));
        ws.close();
      });
      ws.addEventListener("close", () => {
        clearTimeout(timer);
        if (!this.welcome) reject(new Error("socket closed before welcome"));
        this.#failAll(new Error("socket closed"));
      });
      ws.addEventListener("message", (msg) => {
        const f = parseFrame(String(msg.data));
        if (!f) return;
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
    const requestKey = idem ?? this.#requestKey();
    const raw = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.#pending.delete(id);
          reject(new ApxError({ code: "timeout", message: `${method} timed out` }));
        },
        clientDeadline(method, params, this.timeoutMs),
      );
      this.#pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ t: "req", id, method, params, idem: requestKey }));
    });
    return raw as Result<M>;
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
