// The harness registry: which engine runs an agent's turns, and what the setup screen shows about each one.
// A new harness also needs its id, setup copy, official mark and docs: see HUMAN_MODEL.md#4b-the-agent-loop.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import type { EngineStatus, HarnessId } from "@apx/protocol";
import { engineOf, harnessOf } from "../domain/refs.ts";
import type { Store } from "../domain/store.ts";
import { unauthorized } from "../errors.ts";
import { cachedCatalog } from "../models/catalog.ts";
import { modelSettings } from "../models/choice.ts";
import type { Llm } from "../providers/llm.ts";
import { mediaData } from "../services/uploads.ts";
import { harnessDir } from "../tools/folders.ts";
import { acpAgents, acpEngine } from "./acp/agents.ts";
import { acpHarness } from "./acp/harness.ts";
import { claudeHarness } from "./claude.ts";
import { codexHarness, type McpCommand } from "./codex.ts";
import { type CliStatus, detectClaude, detectCodex, which } from "./detect.ts";
import { nativeHarness } from "./native.ts";
import { ONESHOT, oneshotHarness, oneshotStatus } from "./oneshot.ts";
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
  /** Told each time the CLIs are asked again whether they are here and signed in. */
  onDetected?(found: { claude: CliStatus; codex: CliStatus }): void;
}) {
  const { store, llm } = deps;
  const gates = new Map<string, Gate>();
  const bin = (name: string) => async () => {
    const p = await which(name);
    if (!p) throw new Error(`${name} is not installed on this machine`);
    return p;
  };
  /** The turn's folder, made when it is APX's own (a code thread's folder is the owner's and already there). */
  const cwd = (io: TurnIO) => {
    const dir = harnessDir(store, deps.home, io.thread);
    if (!io.thread.cwd) fs.mkdirSync(dir, { recursive: true });
    return dir;
  };
  const proxyFor = (io: TurnIO) => {
    const token = openGate(io);
    const proxy = deps.mcpProxy();
    // The run token travels in the environment: on the command line any local user could read it with ps.
    const command: McpCommand = { ...proxy, env: { ...proxy.env, APX_RUN_TOKEN: token } };
    return { command, close: () => gates.delete(token) };
  };
  const registry: Record<HarnessId, Harness> = {
    native: deps.overrides?.native ?? nativeHarness(llm),
    aider: deps.overrides?.aider ?? oneshotHarness("aider", { cwd }),
    antigravity: deps.overrides?.antigravity ?? oneshotHarness("antigravity", { cwd }),
    claude:
      deps.overrides?.claude ??
      claudeHarness({ claudePath: bin("claude"), cwd, readImage: (id) => mediaData(store, id) }),
    codex:
      deps.overrides?.codex ??
      codexHarness({
        codexPath: bin("codex"),
        cwd,
        gate: proxyFor,
      }),
    acp:
      deps.overrides?.acp ??
      acpHarness({
        agents: () => acpAgents(store),
        binary: (a) => bin(a.command)(),
        cwd,
        gate: proxyFor,
      }),
  };
  function openGate(g: Gate): string {
    const token = randomBytes(24).toString("hex");
    gates.set(token, g);
    return token;
  }

  let cache: { at: number; claude: CliStatus; codex: CliStatus } | undefined;
  const models = modelSettings(store);
  /** The engine of the install default's model ("native" when the default is the router alone). */
  const defaultId = (): HarnessId => {
    const m = models.defaultChoice().model;
    return m ? harnessOf(m) : "native";
  };

  /**
   * ACP agents installed here. Whether one is signed in shows only when a session opens: the model catalog opens one,
   * so its last answer says it (no extra process per status call).
   */
  async function acpStatus(): Promise<EngineStatus[]> {
    const defaultEngine = engineOf(models.defaultChoice().model ?? "");
    const out: EngineStatus[] = [];
    for (const a of acpAgents(store)) {
      if (!(await which(a.command))) continue;
      const id = acpEngine(a);
      const seen = cachedCatalog(store, id);
      out.push({
        id,
        label: a.label,
        installed: true,
        logged_in: seen?.available === true,
        detail: !seen
          ? "ACP · sign-in is checked when its models are listed"
          : `ACP${seen.detail ? ` · ${seen.detail}` : ""}`,
        default: defaultEngine === id,
      });
    }
    return out;
  }

  return {
    get: (id: HarnessId): Harness => registry[id],
    defaultId,
    async status(refresh = false): Promise<EngineStatus[]> {
      if (refresh || !cache || Date.now() - cache.at > STATUS_CACHE_MS) {
        const [claude, codex] = await Promise.all([detectClaude(), detectCodex()]);
        cache = { at: Date.now(), claude, codex };
        deps.onDetected?.({ claude, codex });
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
        ...(await Promise.all(
          (Object.keys(ONESHOT) as Array<keyof typeof ONESHOT>).map(async (id) => ({
            id,
            label: ONESHOT[id].label,
            ...(await oneshotStatus(id)),
            default: false,
          })),
        )),
        ...(await acpStatus()),
      ];
    },
    /** For the MCP proxy of an external harness. */
    gate(token: string): Gate {
      const g = gates.get(token);
      if (!g) throw unauthorized("unknown or finished run");
      return g;
    },
    openGate,
    closeGate: (token: string) => gates.delete(token),
  };
}

export type Harnesses = ReturnType<typeof createHarnesses>;
export type { Harness, TurnIO, TurnOutcome } from "./types.ts";
