// Engines (who runs an agent's turns): installed, signed in, default. The core may predate engines.*: degrade quietly.
import type { HarnessId } from "@apx/protocol";
import { ApxError } from "@apx/protocol/client";
import { type MessageKey, t } from "../i18n/index.ts";
import { client } from "./client.ts";
import { loadModelsConfig } from "./models.ts";
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
    // The default engine is the install default model now: show the new choice.
    void loadModelsConfig();
  } catch (e) {
    notify(missing(e) ? t("engines.defaultUnsupported") : t("error.change", { error: errText(e) }));
  }
}

export async function loadHealth(): Promise<void> {
  try {
    data.set({ health: await client.call("system.health", {}) });
  } catch {
    // Offline: the section shows what it has.
  }
}

/** Translation keys of the browser profiles. */
export const PROFILE_KEY = {
  shared: "profile.shared",
  isolated: "profile.isolated",
  incognito: "profile.incognito",
} as const satisfies Record<string, MessageKey>;
