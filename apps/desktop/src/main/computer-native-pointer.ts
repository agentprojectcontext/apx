import { spawn } from "node:child_process";
import path from "node:path";
import type { Readable, Writable } from "node:stream";

export type CursorAgent = { id: string; name: string };
export type PointerChild = {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  on(event: "error", listener: (error: Error) => void): unknown;
  once(event: "close", listener: () => void): unknown;
  kill(signal: NodeJS.Signals): boolean;
};
type Reply = Record<string, unknown>;
type Session = {
  child: PointerChild;
  ready: Promise<void>;
  closed: Promise<void>;
  pending?: { id: number; resolve(value: Reply): void; reject(error: Error): void };
  retire(error: Error): void;
  dead: boolean;
};

type PointerConfig = { executable: string; launch?: () => PointerChild; deadlineMs?: number };

function startSession(config: PointerConfig, deadline: number, onClosed: (state: Session) => void): Session {
  const child = config.launch?.() ?? spawn(config.executable, ["--pointer"], { stdio: ["pipe", "pipe", "pipe"] });
  let buffer = Buffer.alloc(0);
  let ready = false;
  let failure: Error | undefined;
  let readyResolve: () => void = () => {};
  let readyReject: (error: Error) => void = () => {};
  let closeResolve: () => void = () => {};
  const state: Session = {
    child,
    dead: false,
    ready: new Promise((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    }),
    closed: new Promise((resolve) => {
      closeResolve = resolve;
    }),
    retire(error) {
      if (state.dead) return;
      failure = error;
      state.dead = true;
      child.kill("SIGKILL");
    },
  };
  void state.ready.catch(() => {});
  const timer = setTimeout(() => state.retire(new Error("native pointer handshake timed out")), deadline);
  child.once("close", () => {
    clearTimeout(timer);
    state.dead = true;
    const error = failure ?? new Error("native pointer closed; outcome may be uncertain; do not retry");
    readyReject(error);
    state.pending?.reject(error);
    state.pending = undefined;
    buffer = Buffer.alloc(0);
    onClosed(state);
    closeResolve();
  });
  child.on("error", () => state.retire(new Error("native pointer could not start")));
  child.stdin.on("error", () => state.retire(new Error("native pointer transport failed")));
  child.stdout.on("error", () => state.retire(new Error("native pointer transport failed")));
  child.stderr.on("data", () => state.retire(new Error("unexpected native pointer output")));
  child.stdout.on("data", (chunk: Buffer) => {
    if (state.dead) return;
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > 8192) return state.retire(new Error("native pointer response limit"));
    for (;;) {
      const end = buffer.indexOf(10);
      if (end < 0) break;
      const line = buffer.subarray(0, end).toString("utf8");
      buffer = buffer.subarray(end + 1);
      try {
        const value: unknown = JSON.parse(line);
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
        const reply = value as Reply;
        if (!ready) {
          if (Object.keys(reply).length !== 2 || reply.version !== 1 || reply.ready !== true) throw new Error();
          ready = true;
          clearTimeout(timer);
          readyResolve();
        } else {
          const pending = state.pending;
          if (
            !pending ||
            pending.id !== reply.id ||
            !["accepted", "unsupported", "uncertain"].includes(String(reply.status))
          )
            throw new Error();
          state.pending = undefined;
          pending.resolve(reply);
        }
      } catch {
        state.retire(new Error("invalid native pointer response; outcome may be uncertain; do not retry"));
        return;
      }
    }
  });
  return state;
}

/** A private inherited-pipe child, never a shell command or a listening service. */
export function createNativePointer(config: PointerConfig) {
  if (!path.isAbsolute(config.executable)) throw new Error("native pointer executable must be absolute");
  const deadline = config.deadlineMs ?? 4000;
  if (!Number.isSafeInteger(deadline) || deadline < 1 || deadline > 10000) throw new Error("invalid native deadline");
  let session: Session | undefined;
  let closing: Promise<void> = Promise.resolve();
  let queue: Promise<unknown> = Promise.resolve();
  let generation = 0;
  let nextId = 0;
  let closed = false;
  let agent: CursorAgent = { id: "owner", name: "APX" };

  const request = (op: string, params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<Reply> => {
    const epoch = generation;
    const identity = { ...agent };
    const operation = async () => {
      if (closed || epoch !== generation || signal?.aborted) throw new Error("pointer action cancelled; do not retry");
      await closing;
      if (closed || epoch !== generation || signal?.aborted) throw new Error("pointer action cancelled; do not retry");
      if (!session)
        session = startSession(config, deadline, (ended) => {
          if (session === ended) session = undefined;
        });
      const state = session;
      const abort = () => state.retire(new Error("pointer action cancelled; outcome may be uncertain; do not retry"));
      signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(
        () => state.retire(new Error("pointer action timed out; outcome may be uncertain; do not retry")),
        deadline,
      );
      try {
        if (signal?.aborted) abort();
        await state.ready;
        if (state.dead || epoch !== generation) {
          await state.closed;
          throw new Error("pointer action cancelled; do not retry");
        }
        const id = ++nextId;
        return await new Promise<Reply>((resolve, reject) => {
          state.pending = { id, resolve, reject };
          state.child.stdin.write(
            `${JSON.stringify({ id, op, agent: identity.id, label: identity.name, ...params })}\n`,
          );
        });
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      }
    };
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };
  const hide = () => {
    generation++;
    const old = session;
    if (old) {
      old.retire(new Error("pointer action cancelled; outcome may be uncertain; do not retry"));
      closing = old.closed;
    }
  };
  const note = (text: string) =>
    (agent.id === "owner" ? text || "APX" : `${agent.name.trim().split(/\s+/)[0]}${text ? ` · ${text}` : ""}`).slice(
      0,
      80,
    );
  return {
    selectAgent(value: CursorAgent) {
      agent = { id: value.id.slice(0, 128), name: value.name.slice(0, 80) };
    },
    async moveTo(x: number, y: number, label: string): Promise<void> {
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("invalid screen point");
      const reply = await request("move", { x, y, label: note(label) });
      if (reply.status !== "accepted") throw new Error("native cursor could not move");
    },
    say(label: string) {
      void request("say", { label: note(label) }).catch(() => {});
    },
    pulse() {
      void request("pulse").catch(() => {});
    },
    hide,
    close() {
      closed = true;
      hide();
    },
    async drained() {
      await closing;
    },
    async press(app: string, x: number, y: number, signal: AbortSignal): Promise<string> {
      if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) throw new Error("invalid screen point");
      const reply = await request("press", { app, x, y }, signal);
      if (reply.status === "unsupported")
        throw new Error(`pointer action refused (${String(reply.reason)}); no activation delivered`);
      if (
        reply.status !== "accepted" ||
        reply.action !== "pressed" ||
        typeof reply.role !== "string" ||
        !/^AX[A-Za-z]+$/.test(reply.role)
      )
        throw new Error("pointer action outcome uncertain; do not retry");
      void request("pulse").catch(() => {});
      return `native accessible press; pressed ${reply.role}`;
    },
  };
}
export type NativePointer = ReturnType<typeof createNativePointer>;
