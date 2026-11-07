import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { TextDecoder } from "node:util";

export type ObserverCommand =
  | { op: "listWindows"; pid: number; launchIdentity: { seconds: number; microseconds: number } }
  | { op: "observeSelected"; pid: number; launchIdentity: { seconds: number; microseconds: number }; handle: string };

export type ObserverClock = { after(ms: number, callback: () => void): () => void };
const clock: ObserverClock = {
  after(ms, callback) {
    const timer = setTimeout(callback, ms);
    return () => clearTimeout(timer);
  },
};

type Pending = {
  id: string;
  resolve(value: Record<string, unknown>): void;
  reject(error: Error): void;
  cancel(): void;
};

/** Private lab transport only; returned JSON still needs operation-specific validation by its trusted caller. */
export class OwnedObserver {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #clock: ObserverClock;
  readonly #deadline: number;
  readonly #closed: Promise<void>;
  readonly #hello: Promise<void>;
  #ready = false;
  #terminal: Error | undefined;
  #pending: Pending | undefined;
  #buffer = Buffer.alloc(0);
  #stderrBytes = 0;
  #cancelHello: () => void = () => {};
  #resolveHello: () => void = () => {};
  #rejectHello: (error: Error) => void = () => {};

  constructor(config: {
    executable: string;
    home: string;
    /** Trusted launcher arguments, never supplied by an agent or observation caller. */
    args?: readonly string[];
    clock?: ObserverClock;
    deadlineMs?: number;
  }) {
    if (!path.isAbsolute(config.executable) || !path.isAbsolute(config.home)) throw new Error("INVALID_CONFIG");
    this.#deadline = config.deadlineMs ?? 4000;
    if (!Number.isSafeInteger(this.#deadline) || this.#deadline < 1 || this.#deadline > 10_000)
      throw new Error("INVALID_CONFIG");
    this.#clock = config.clock ?? clock;
    this.#hello = new Promise((resolve, reject) => {
      this.#resolveHello = resolve;
      this.#rejectHello = reject;
    });
    // A stop or spawn error may precede a caller awaiting readiness.
    void this.#hello.catch(() => {});
    this.#child = spawn(config.executable, [...(config.args ?? [])], {
      shell: false,
      cwd: config.home,
      env: { HOME: config.home, LANG: "C", LC_ALL: "C" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#closed = new Promise((resolve) => {
      this.#child.once("close", () => {
        this.#terminal ??= new Error("OBSERVER_EXITED");
        this.#cancelHello();
        this.#rejectHello(this.#terminal);
        const pending = this.#pending;
        this.#pending = undefined;
        pending?.cancel();
        pending?.reject(this.#terminal);
        this.#buffer = Buffer.alloc(0);
        resolve();
      });
    });
    this.#child.on("error", () => this.#fail("OBSERVER_SPAWN_FAILED"));
    this.#child.stdin.on("error", () => this.#fail("OBSERVER_TRANSPORT_FAILED"));
    this.#child.stdout.on("error", () => this.#fail("OBSERVER_TRANSPORT_FAILED"));
    this.#child.stderr.on("error", () => this.#fail("OBSERVER_TRANSPORT_FAILED"));
    this.#child.stdout.on("data", (chunk: Buffer) => this.#receive(chunk));
    this.#child.stderr.on("data", (chunk: Buffer) => {
      this.#stderrBytes += chunk.length;
      if (this.#stderrBytes > 8192) this.#fail("OBSERVER_OUTPUT_LIMIT");
      else if (chunk.length) this.#fail("OBSERVER_STDERR");
    });
    this.#cancelHello = this.#clock.after(this.#deadline, () => this.#fail("OBSERVER_DEADLINE"));
    this.#write('{"op":"hello"}\n');
  }

  async ready(): Promise<void> {
    await this.#hello;
    if (this.#terminal) {
      await this.#closed;
      throw this.#terminal;
    }
  }

  async request(command: ObserverCommand): Promise<Record<string, unknown>> {
    await this.ready();
    if (this.#terminal) {
      await this.#closed;
      throw this.#terminal;
    }
    if (this.#pending) throw new Error("OBSERVER_BUSY");
    const id = randomUUID();
    const line = JSON.stringify({ requestID: id, command });
    if (Buffer.byteLength(line) > 8192) throw new Error("OBSERVER_INPUT_LIMIT");
    return new Promise((resolve, reject) => {
      const cancel = this.#clock.after(this.#deadline, () => this.#fail("OBSERVER_DEADLINE"));
      this.#pending = { id, resolve, reject, cancel };
      this.#write(`${line}\n`);
    });
  }

  /** Terminal, idempotent, and waits for the owned process and pipes to close. Never restarts or replays. */
  async stop(): Promise<void> {
    this.#fail("OBSERVER_STOPPED");
    await this.#closed;
  }

  #write(line: string): void {
    if (this.#terminal) return;
    this.#child.stdin.write(line, (error) => {
      if (error) this.#fail("OBSERVER_TRANSPORT_FAILED");
    });
  }

  #fail(code: string): void {
    if (this.#terminal) return;
    this.#terminal = new Error(code);
    this.#cancelHello();
    this.#pending?.cancel();
    this.#child.kill("SIGKILL");
    this.#child.stdin.destroy();
  }

  #receive(chunk: Buffer) {
    if (this.#terminal) return;
    if (this.#ready && !this.#pending) return this.#fail("OBSERVER_UNEXPECTED_RESPONSE");
    if (this.#buffer.length + chunk.length > 65_537) return this.#fail("OBSERVER_OUTPUT_LIMIT");
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    const newline = this.#buffer.indexOf(10);
    if (newline < 0) return;
    // Refuse buffered suffixes as well as checking request identity below.
    if (newline !== this.#buffer.length - 1) return this.#fail("OBSERVER_INVALID_FRAME");
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(this.#buffer.subarray(0, newline)));
    } catch {
      return this.#fail("OBSERVER_INVALID_FRAME");
    }
    this.#buffer = Buffer.alloc(0);
    if (!value || typeof value !== "object" || Array.isArray(value)) return this.#fail("OBSERVER_INVALID_FRAME");
    const object = value as Record<string, unknown>;
    if (!this.#ready) {
      if (object.version !== 1 || object.ready !== true || Object.keys(object).length !== 2)
        return this.#fail("OBSERVER_INVALID_HELLO");
      this.#cancelHello();
      this.#ready = true;
      this.#resolveHello();
      return;
    }
    const pending = this.#pending;
    const result = object.result;
    if (
      !pending ||
      object.requestID !== pending.id ||
      Object.keys(object).length !== 2 ||
      !result ||
      typeof result !== "object" ||
      Array.isArray(result) ||
      (result as Record<string, unknown>).version !== 1
    )
      return this.#fail("OBSERVER_UNEXPECTED_RESPONSE");
    this.#pending = undefined;
    pending.cancel();
    pending.resolve(result as Record<string, unknown>);
  }
}
