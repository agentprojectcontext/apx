import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";

export const LIMITS = Object.freeze({ bytes: 131072, timeoutMs: 4000, nodes: 512, depth: 32 });
export type Execution = { stdout: string; stderr: string; exitCode: number };
export type Executor = (
  binary: string,
  args: readonly string[],
  options: {
    env: Readonly<Record<string, string>>;
    timeout: number;
    maxBuffer: number;
    shell: false;
  },
) => Promise<Execution>;

// No inherited environment, shell, tracing, or physical-input flags.
export const executeFile: Executor = (binary, args, options) =>
  new Promise((resolve, reject) => {
    execFile(binary, [...args], { ...options, encoding: "utf8", killSignal: "SIGKILL" }, (error, stdout, stderr) => {
      if (error && (typeof error.code !== "number" || error.killed)) {
        reject(new BridgeError("TRANSPORT_UNCERTAIN"));
        return;
      }
      resolve({ stdout, stderr, exitCode: typeof error?.code === "number" ? error.code : 0 });
    });
  });

export class BridgeError extends Error {
  readonly code: string;
  readonly disposition: Readonly<Record<string, string>> | undefined;
  constructor(code: string, disposition?: Readonly<Record<string, string>>) {
    super(code);
    this.code = code;
    this.disposition = disposition;
  }
}

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BridgeError("INVALID_OUTPUT");
  return value as ObjectValue;
}
function hasControl(value: string): boolean {
  return Array.from(value).some((character) => character.charCodeAt(0) < 32);
}
function text(value: unknown, max = 256): string {
  if (typeof value !== "string" || !value.length || value.length > max || hasControl(value)) {
    throw new BridgeError("INVALID_VALUE");
  }
  return value;
}
function selector(value: unknown): string {
  const result = text(value);
  if (result.startsWith("-")) throw new BridgeError("INVALID_SELECTOR");
  return result;
}
function strings(value: unknown): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > 64) throw new BridgeError("INVALID_OUTPUT");
  return Object.freeze(value.map((item) => text(item)));
}

export type Target = Readonly<{ snapshot: string; ref: string; app: string; window: string }>;
export type Node = Readonly<{
  ref?: string;
  role: string;
  name?: string;
  states: readonly string[];
  actions: readonly string[];
  children: readonly Node[];
}>;
export type Snapshot = Readonly<{ id: string; app: string; window: string; tree: Node }>;
type Binding = { native: string; target: Target; node: Node };
type Config = {
  binary: string;
  home: string;
  namespace: string;
  expectedVersion: string;
  execute: Executor;
  authorize: (action: "click" | "type", target: Target) => boolean;
};

export class AccessibilityLabBridge {
  #config: Config;
  #refs = new Map<string, Binding>();
  #snapshot: Snapshot | undefined;
  #busy = false;
  #ready = false;

  constructor(config: Config) {
    if (
      !isAbsolute(config.binary) ||
      !isAbsolute(config.home) ||
      hasControl(config.binary + config.home) ||
      !/^[a-zA-Z0-9_-]{1,64}$/u.test(config.namespace) ||
      !/^\d+\.\d+\.\d+$/u.test(config.expectedVersion)
    ) {
      throw new BridgeError("INVALID_CONFIG");
    }
    this.#config = { ...config };
  }

  async #exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (this.#busy) throw new BridgeError("BUSY");
    this.#busy = true;
    try {
      return await work();
    } finally {
      this.#busy = false;
    }
  }

  async #call(command: string, args: readonly string[] = []): Promise<ObjectValue> {
    let result: Execution;
    try {
      result = await this.#config.execute(
        this.#config.binary,
        ["--session", this.#config.namespace, command, ...args],
        {
          env: Object.freeze({ HOME: this.#config.home }),
          timeout: LIMITS.timeoutMs,
          maxBuffer: LIMITS.bytes,
          shell: false,
        },
      );
    } catch {
      throw new BridgeError("TRANSPORT_UNCERTAIN");
    }
    if (
      typeof result.stdout !== "string" ||
      typeof result.stderr !== "string" ||
      Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) > LIMITS.bytes ||
      (result.stdout + result.stderr).includes(String.fromCharCode(0))
    )
      throw new BridgeError("INVALID_OUTPUT");
    let envelope: ObjectValue;
    try {
      envelope = object(JSON.parse(result.stdout));
    } catch {
      throw new BridgeError("INVALID_OUTPUT");
    }
    if (envelope.version !== "2.5" || envelope.command !== command || typeof envelope.ok !== "boolean") {
      throw new BridgeError("PROTOCOL_MISMATCH");
    }
    if (!envelope.ok) {
      const error = object(envelope.error);
      const disposition = object(error.disposition);
      const bounded: Record<string, string> = {};
      if (Object.keys(disposition).length > 8) throw new BridgeError("INVALID_OUTPUT");
      for (const [key, value] of Object.entries(disposition)) bounded[text(key, 64)] = text(value, 64);
      throw new BridgeError(text(error.code, 64), Object.freeze(bounded));
    }
    if (result.exitCode !== 0 || result.stderr.length > 0) throw new BridgeError("INVALID_OUTPUT");
    return object(envelope.data);
  }

  async #initialize(): Promise<void> {
    if (this.#ready) return;
    const data = await this.#call("version");
    if (data.version !== this.#config.expectedVersion) throw new BridgeError("VERSION_MISMATCH");
    this.#ready = true;
  }

  #binding(target: Target): Binding {
    const binding = this.#refs.get(target.ref);
    if (!binding || binding.target.snapshot !== target.snapshot || target.snapshot !== this.#snapshot?.id) {
      throw new BridgeError("STALE_OR_FOREIGN_REF");
    }
    if (binding.target.app !== target.app || binding.target.window !== target.window) {
      throw new BridgeError("TARGET_MISMATCH");
    }
    return binding;
  }

  async snapshot(
    options: { app?: string; window?: string; skeleton?: boolean; root?: Target } = {},
  ): Promise<Snapshot> {
    return this.#exclusive(async () => {
      const root = options.root ? this.#binding(options.root) : undefined;
      const app = options.app === undefined ? root?.target.app : selector(options.app);
      const window = options.window === undefined ? root?.target.window : selector(options.window);
      if (root && (app !== root.target.app || window !== root.target.window)) throw new BridgeError("TARGET_MISMATCH");
      this.#refs.clear();
      this.#snapshot = undefined;
      await this.#initialize();
      const args = ["--timeout-ms", "3000", "--max-depth", "16"];
      if (app !== undefined) args.push("--app", app);
      if (window !== undefined) args.push("--window-id", window);
      if (options.skeleton) args.push("--skeleton");
      if (root) args.push("--root", root.native);
      const data = await this.#call("snapshot", args);
      if (data.complete !== true || data.truncated === true) throw new BridgeError("INCOMPLETE_SNAPSHOT");
      const actualApp = text(data.app);
      const actualWindow = text(object(data.window).id);
      if ((app !== undefined && app !== actualApp) || (window !== undefined && window !== actualWindow)) {
        throw new BridgeError("TARGET_MISMATCH");
      }
      const nativeId = text(data.snapshot_id);
      if (!/^[a-zA-Z0-9_-]+$/u.test(nativeId)) throw new BridgeError("INVALID_OUTPUT");
      const id = randomUUID();
      const refs = new Map<string, Binding>();
      const nativeRefs = new Set<string>();
      let count = 0;
      const visit = (value: unknown, depth: number): Node => {
        if (++count > LIMITS.nodes || depth > LIMITS.depth) throw new BridgeError("TREE_LIMIT");
        const raw = object(value);
        if (raw.subtree_truncated === true && !options.skeleton) throw new BridgeError("INCOMPLETE_SNAPSHOT");
        const states = strings(raw.states);
        const actions = strings(raw.available_actions);
        const role = text(raw.role);
        if (raw.children !== undefined && !Array.isArray(raw.children)) throw new BridgeError("INVALID_OUTPUT");
        let ref: string | undefined;
        let native: string | undefined;
        if (raw.ref_id !== undefined) {
          native = text(raw.ref_id);
          if (
            !native.startsWith(`@${nativeId}:`) ||
            !/^@[a-zA-Z0-9_-]+:e\d+$/u.test(native) ||
            nativeRefs.has(native)
          ) {
            throw new BridgeError("INVALID_OUTPUT");
          }
          nativeRefs.add(native);
          ref = randomUUID();
        }
        const children = Object.freeze(
          ((raw.children as unknown[] | undefined) ?? []).map((child) => visit(child, depth + 1)),
        );
        const node: Node = Object.freeze({
          ref,
          role,
          name: raw.name === undefined || raw.name === null || raw.name === "" ? undefined : text(raw.name, 2048),
          states,
          actions,
          children,
        });
        if (ref && native)
          refs.set(ref, {
            native,
            node,
            target: Object.freeze({ snapshot: id, ref, app: actualApp, window: actualWindow }),
          });
        return node;
      };
      const tree = visit(data.tree, 0);
      if (data.ref_count !== refs.size) throw new BridgeError("INVALID_OUTPUT");
      const snapshot = Object.freeze({ id, app: actualApp, window: actualWindow, tree });
      this.#refs = refs;
      this.#snapshot = snapshot;
      return snapshot;
    });
  }

  async click(target: Target): Promise<never> {
    return this.#mutation("click", target);
  }
  async type(target: Target, value: string): Promise<never> {
    if (typeof value !== "string" || Buffer.byteLength(value) > 4096 || hasControl(value)) {
      throw new BridgeError("INVALID_TEXT");
    }
    return this.#mutation("type", target);
  }

  async #mutation(action: "click" | "type", target: Target): Promise<never> {
    return this.#exclusive(async () => {
      const binding = this.#binding(target);
      const { states, role, actions } = binding.node;
      if (/secure|password/iu.test(role) || states.some((state) => /secure|password/iu.test(state)))
        throw new BridgeError("SECURE_TARGET");
      if (states.includes("disabled") || states.includes("hidden")) throw new BridgeError("UNAVAILABLE_TARGET");
      if (!actions.includes(action === "click" ? "Click" : "TypeText")) throw new BridgeError("UNAVAILABLE_ACTION");
      if (!this.#config.authorize(action, binding.target)) throw new BridgeError("NOT_APPROVED");
      // Upstream states may silently fall back to cached metadata; this is not a security attestation.
      const current = await this.#call("get", [binding.native, "--property", "states"]);
      if (current.property !== "states" || current.ref !== binding.native) throw new BridgeError("INVALID_OUTPUT");
      const liveStates = strings(current.value);
      if (liveStates.some((state) => /secure|password/iu.test(state))) throw new BridgeError("SECURE_TARGET");
      if (liveStates.includes("disabled") || liveStates.includes("hidden")) throw new BridgeError("UNAVAILABLE_TARGET");
      throw new BridgeError("ATOMIC_NATIVE_GUARD_REQUIRED");
    });
  }
}
