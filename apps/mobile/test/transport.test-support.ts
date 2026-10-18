import * as Crypto from "expo-crypto";
import { isMethodName, methods, PROTOCOL_VERSION } from "../../../packages/protocol/src/index.ts";

export const credentials = { url: "https://core.example.com", token: "paired-test-token", device: "dev_phone" };

export function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** Native network boundaries only: hooks and the shared SDK execute unchanged. */
export function transport(options: { holdWelcome?: boolean } = {}) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const faults: Record<string, { code: string; message: string }> = {};
  const responses: Record<string, unknown | ((params: Record<string, unknown>) => unknown)> = {
    "threads.list": { threads: [] },
    "projects.list": { projects: [] },
    "agents.list": { agents: [] },
    "tasks.list": { tasks: [], columns: [] },
    "notifications.list": { notifications: [], unread: 0 },
    "runs.pending": { inputs: [] },
    "routines.list": { routines: [] },
    "engines.status": { engines: [] },
    "jobs.list": { running: [] },
    "owner.get": { name: "Alex" },
    "channels.list": { channels: [] },
    "memory.settings": { total: 0 },
  };
  let requestId = 0;
  jest
    .spyOn(Crypto, "randomUUID")
    .mockImplementation(() => `f89d0356-6cca-4cc0-88ee-${String(++requestId).padStart(12, "0")}`);
  const fetch = jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    expect(url.origin).toBe(credentials.url);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual(expect.objectContaining({ authorization: `Bearer ${credentials.token}` }));
    const method = url.pathname.slice("/rpc/".length);
    if (!isMethodName(method)) throw new Error(`Unregistered method ${method}`);
    const params = JSON.parse(String(init?.body)) as Record<string, unknown>;
    methods[method].params.parse(params);
    calls.push({ method, params });
    if (faults[method])
      return { ok: false, status: 403, json: async () => ({ ok: false, error: faults[method] }) } as Response;
    if (!(method in responses)) throw new Error(`Unexpected request ${method}`);
    const response = responses[method];
    const result = await (typeof response === "function" ? response(params) : response);
    if (result instanceof Error) throw result;
    return { ok: true, json: async () => ({ ok: true, result }) } as Response;
  });
  const sockets: Socket[] = [];
  class Socket {
    static OPEN = 1;
    static CLOSED = 3;
    readyState = 0;
    #seq = 0;
    #listeners = new Map<string, Set<(event: { data?: string }) => void>>();
    constructor(readonly url: string) {
      sockets.push(this);
      queueMicrotask(() => {
        this.readyState = 1;
        this.#emit("open", {});
      });
    }
    addEventListener(type: string, listener: (event: { data?: string }) => void, options?: { once?: boolean }) {
      const callbacks = this.#listeners.get(type) ?? new Set();
      const wrapped = options?.once
        ? (event: { data?: string }) => {
            callbacks.delete(wrapped);
            listener(event);
          }
        : listener;
      callbacks.add(wrapped);
      this.#listeners.set(type, callbacks);
    }
    #emit(type: string, event: { data?: string }) {
      for (const listener of [...(this.#listeners.get(type) ?? [])]) listener(event);
    }
    send(raw: string) {
      const frame = JSON.parse(raw) as { t: string };
      expect(frame.t).toBe("hello");
      if (!options.holdWelcome) this.welcome();
    }
    welcome() {
      this.#emit("message", { data: JSON.stringify({ t: "welcome", protocol: PROTOCOL_VERSION }) });
    }
    event(payload: unknown, stream = "core", seq = ++this.#seq) {
      this.#emit("message", { data: JSON.stringify({ t: "event", stream, seq, type: "changed", payload }) });
    }
    close() {
      if (this.readyState === Socket.CLOSED) return;
      this.readyState = Socket.CLOSED;
      this.#emit("close", {});
    }
  }
  const original = globalThis.WebSocket;
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  return {
    calls,
    faults,
    responses,
    fetch,
    sockets,
    restore() {
      for (const socket of sockets) socket.close();
      globalThis.WebSocket = original;
    },
  };
}
