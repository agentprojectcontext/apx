// The harness registry: which engine runs an agent's turns, and what the setup screen shows about each one.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { EngineStatus, HarnessId } from "@apx/protocol";
import type { Store } from "../domain/store.ts";
import { CallError } from "../errors.ts";
import type { Llm } from "../providers/llm.ts";
import { claudeHarness } from "./claude.ts";
import { codexHarness, type McpCommand } from "./codex.ts";
import { type CliStatus, detectClaude, detectCodex, which } from "./detect.ts";
import { nativeHarness } from "./native.ts";
import type { Harness, TurnIO } from "./types.ts";

const STATUS_CACHE_MS = 60_000;

/** A run's tools, reachable out of process (Codex's MCP proxy) only with the run's token. */
type Gate = Pick<TurnIO, "tools" | "execute" | "run">;

export function createHarnesses(deps: {
  store: Store;
  llm: Llm;
  home: string;
  /** How a child process reaches this core's tool gate (the MCP proxy command, minus the token). */
  mcpProxy: () => { command: string; args: string[]; env: Record<string, string> };
  overrides?: Partial<Record<HarnessId, Harness>>;
}) {
  const { store, llm } = deps;
  const cwd = path.join(deps.home, "work");
  const gates = new Map<string, Gate>();
  const bin = (name: string) => async () => {
    const p = await which(name);
    if (!p) throw new Error(`${name} is not installed on this machine`);
    fs.mkdirSync(cwd, { recursive: true });
    return p;
  };
  const registry: Record<HarnessId, Harness> = {
    native: deps.overrides?.native ?? nativeHarness(llm),
    claude: deps.overrides?.claude ?? claudeHarness({ claudePath: bin("claude"), cwd }),
    codex:
      deps.overrides?.codex ??
      codexHarness({
        codexPath: bin("codex"),
        cwd,
        gate: (io) => {
          const token = openGate(io);
          const proxy = deps.mcpProxy();
          const command: McpCommand = { ...proxy, args: [...proxy.args, token] };
          return { command, close: () => gates.delete(token) };
        },
      }),
  };
  function openGate(g: Gate): string {
    const token = randomBytes(24).toString("hex");
    gates.set(token, g);
    return token;
  }

  let cache: { at: number; claude: CliStatus; codex: CliStatus } | undefined;
  const defaultId = (): HarnessId => (store.settings.get("default_harness") as HarnessId | undefined) ?? "native";

  return {
    get: (id: HarnessId): Harness => registry[id],
    defaultId,
    setDefault(id: HarnessId): void {
      store.settings.set("default_harness", id);
    },
    async status(refresh = false): Promise<EngineStatus[]> {
      if (refresh || !cache || Date.now() - cache.at > STATUS_CACHE_MS) {
        const [claude, codex] = await Promise.all([detectClaude(), detectCodex()]);
        cache = { at: Date.now(), claude, codex };
      }
      const d = defaultId();
      const label = llm.label();
      return [
        {
          id: "native",
          label: "APX (built-in model)",
          installed: true,
          logged_in: label !== "none",
          detail: label,
          default: d === "native",
        },
        { id: "claude", label: "Claude Code", ...cache.claude, default: d === "claude" },
        { id: "codex", label: "Codex", ...cache.codex, default: d === "codex" },
      ];
    },
    /** For the MCP proxy of an external harness. */
    gate(token: string): Gate {
      const g = gates.get(token);
      if (!g) throw new CallError({ code: "unauthorized", message: "unknown or finished run" });
      return g;
    },
    openGate,
    closeGate: (token: string) => gates.delete(token),
  };
}

export type Harnesses = ReturnType<typeof createHarnesses>;
export type { Harness, TurnIO, TurnOutcome } from "./types.ts";
