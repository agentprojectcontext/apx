// Model catalog, install default and router (D-011). Model names only ever come from the core.
import type { CatalogEngine, ModelChoice, ModelRef, RouterConfig } from "@apx/protocol";
import { ApxError } from "@apx/protocol/client";
import { t } from "../i18n/index.ts";
import { client } from "./client.ts";
import { createStore, useSlice } from "./createStore.ts";
import { notify } from "./notices.ts";
import { data } from "./state.ts";

export type ModelsConfig = { default: ModelChoice; router: RouterConfig };

type ModelsState = {
  catalog: CatalogEngine[];
  /** `unavailable` = this core does not answer models.* (older build). */
  catalogLoad: "idle" | "loading" | "ready" | "unavailable";
  config: ModelsConfig | undefined;
};

export const models = createStore<ModelsState>({ catalog: [], catalogLoad: "idle", config: undefined });

export function useModels<T>(select: (s: ModelsState) => T): T {
  return useSlice(models, select);
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const missing = (e: unknown) => e instanceof ApxError && e.code === "unknown_method";

/** Every engine and its models. `refresh` asks the engines again instead of the day cache. */
export async function loadCatalog(refresh = false): Promise<void> {
  if (models.get().catalogLoad === "loading") return;
  models.set((s) => ({ catalogLoad: s.catalog.length ? s.catalogLoad : "loading" }));
  try {
    const r = await client.call("models.list", { refresh });
    models.set({ catalog: r.engines, catalogLoad: "ready" });
  } catch (e) {
    models.set((s) => ({ catalogLoad: missing(e) || !s.catalog.length ? "unavailable" : "ready" }));
    if (refresh && !missing(e)) notify(t("error.loadModels", { error: errText(e) }));
  }
}

export async function loadModelsConfig(): Promise<void> {
  try {
    models.set({ config: await client.call("models.config", {}) });
  } catch {
    // Older core or offline: the pickers fall back to "Default".
  }
}

/** Saves the install default or the router; returns false when the core refused. */
export async function saveModelsConfig(patch: Partial<ModelsConfig>): Promise<boolean> {
  try {
    models.set({ config: await client.call("models.set_config", patch) });
    return true;
  } catch (e) {
    notify(t("error.change", { error: errText(e) }));
    return false;
  }
}

/** null = back to the install default. */
export async function setAgentModelChoice(agent: string, choice: ModelChoice | null): Promise<void> {
  try {
    const next = await client.call("agents.update", { agent, model_choice: choice });
    data.set((s) => ({ agents: { ...s.agents, [next.id]: next } }));
  } catch (e) {
    notify(t("error.changeModel", { error: errText(e) }));
  }
}

/** "gemini/gemini-3.6-flash" → engine "gemini", model "gemini-3.6-flash"; "claude" → engine only. */
export function splitRef(ref: ModelRef): { engine: string; model?: string } {
  const i = ref.indexOf("/");
  return i < 0 ? { engine: ref } : { engine: ref.slice(0, i), model: ref.slice(i + 1) };
}

/** Whether the catalog knows a ref (an engine alone, or one of its models). */
export function inCatalog(ref: ModelRef, catalog: readonly CatalogEngine[]): boolean {
  const { engine, model } = splitRef(ref);
  const e = catalog.find((x) => x.id === engine);
  return Boolean(e) && (!model || Boolean(e?.models.some((m) => m.id === model)));
}

/** A ref as people read it: an engine alone is "<Engine> default", a model stays its ref. */
export function refLabel(ref: ModelRef, catalog: readonly CatalogEngine[]): string {
  const { engine, model } = splitRef(ref);
  if (model) return ref;
  const label = catalog.find((x) => x.id === engine)?.label ?? engine;
  return t("models.engineDefault", { engine: label });
}

/** Short form for chips and summaries: an engine alone is just its label. */
function shortRef(ref: ModelRef, catalog: readonly CatalogEngine[]): string {
  const { engine, model } = splitRef(ref);
  return model ? ref : (catalog.find((x) => x.id === engine)?.label ?? engine);
}

/** "Router", "<model>", or "<model> → router". */
export function choiceLabel(choice: ModelChoice, catalog: readonly CatalogEngine[]): string {
  if (!choice.model) return t("models.router");
  const m = shortRef(choice.model, catalog);
  return choice.router ? t("models.withRouter", { model: m }) : m;
}

/** What an agent runs on: its own choice, or "Default (<install default>)". */
export function agentChoiceLabel(
  choice: ModelChoice | undefined,
  config: ModelsConfig | undefined,
  catalog: readonly CatalogEngine[],
): string {
  if (choice) return choiceLabel(choice, catalog);
  return config ? t("models.defaultWith", { choice: choiceLabel(config.default, catalog) }) : t("models.default");
}
