// Engines (who runs an agent's turns) and per-agent harness. The core may predate engines.*: degrade quietly.
import type { EngineStatus, HarnessId } from "@apx/protocol";
import { ApxError } from "@apx/protocol/client";
import { type MessageKey, t } from "../i18n/index.ts";
import { client } from "./client.ts";
import { notify } from "./notices.ts";
import { data } from "./state.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const missing = (e: unknown) => e instanceof ApxError && e.code === "unknown_method";

/** Installed / logged-in state of each engine. `refresh` asks the core to re-probe the CLIs. */
export async function loadEngines(refresh = false): Promise<void> {
  if (data.get().enginesLoad === "loading") return;
  data.set((s) => ({ enginesLoad: s.engines.length ? s.enginesLoad : "loading" }));
  try {
    const r = await client.call("engines.status", { refresh });
    data.set({ engines: r.engines, enginesLoad: "ready" });
  } catch (e) {
    data.set({ enginesLoad: missing(e) ? "unavailable" : data.get().engines.length ? "ready" : "unavailable" });
    if (refresh && !missing(e)) notify(t("error.checkEngines", { error: errText(e) }));
  }
}

export async function setDefaultEngine(engine: HarnessId): Promise<void> {
  try {
    const r = await client.call("engines.set_default", { engine });
    data.set({ engines: r.engines, enginesLoad: "ready" });
  } catch (e) {
    notify(missing(e) ? t("engines.defaultUnsupported") : t("error.change", { error: errText(e) }));
  }
}

/** null = back to the install default. */
export async function setAgentHarness(agent: string, harness: HarnessId | null): Promise<void> {
  try {
    const next = await client.call("agents.update", { agent, harness });
    data.set((s) => ({ agents: { ...s.agents, [next.id]: next } }));
  } catch (e) {
    notify(t("error.changeEngine", { error: errText(e) }));
  }
}

export async function loadHealth(): Promise<void> {
  try {
    data.set({ health: await client.call("system.health", {}) });
  } catch {
    // Offline: the section shows what it has.
  }
}

const FALLBACK_LABEL: Record<HarnessId, string> = { native: "APX (Gemini)", claude: "Claude", codex: "Codex" };

/** Display name of an engine: what the core reports, else a stable fallback. */
export function engineLabel(id: HarnessId, engines: readonly EngineStatus[]): string {
  return engines.find((e) => e.id === id)?.label ?? FALLBACK_LABEL[id];
}

/** What runs an agent: its own harness, or the install default ("Default · X"). */
export function agentEngineLabel(harness: HarnessId | undefined, engines: readonly EngineStatus[]): string {
  if (harness) return engineLabel(harness, engines);
  const def = engines.find((e) => e.default);
  return def ? t("engine.defaultWith", { engine: def.label }) : t("engine.default");
}

/** Translation keys of the browser profiles. */
export const PROFILE_KEY = {
  shared: "profile.shared",
  isolated: "profile.isolated",
  incognito: "profile.incognito",
} as const satisfies Record<string, MessageKey>;
