// Model catalog, install default and router (D-011). Model names only ever come from the core.
import type { CatalogEngine, ModelChoice, ModelRef, RouterConfig } from "@apx/protocol";
import { ApxError } from "@apx/protocol/client";
import { registerIntegrationMarks, registerMarks } from "@apx/ui";
import { isKey, t } from "../i18n/index.ts";
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

let marks: Promise<void> | undefined;
/**
 * The ACP agents', model APIs' and integrations' marks: kept out of the first load, they come with the catalog right
 * after it, or with the integrations list if that opens first.
 */
export function loadMarks(): void {
  marks ??= import("@apx/ui/marks")
    .then((m) => {
      registerMarks({ ...m.ACP_MARKS, ...m.PROVIDER_MARKS });
      registerIntegrationMarks(m.INTEGRATION_MARKS, m.drawMarkArt);
    })
    .catch(() => {
      marks = undefined;
    });
}

/** The latest catalog request: an older answer arriving after it (a provider switched off, then on) is dropped. */
let catalogAsk = 0;

/** Every engine and its models. `refresh` asks the engines again instead of the day cache. */
export async function loadCatalog(refresh = false): Promise<void> {
  loadMarks();
  if (models.get().catalogLoad === "loading") return;
  models.set((s) => ({ catalogLoad: s.catalog.length ? s.catalogLoad : "loading" }));
  const ask = ++catalogAsk;
  try {
    const r = await client.call("models.list", { refresh });
    if (ask !== catalogAsk) return;
    models.set({ catalog: r.engines, catalogLoad: "ready" });
  } catch (e) {
    if (ask !== catalogAsk) return;
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

/**
 * "gemini/gemini-3.6-flash" → engine "gemini", model "gemini-3.6-flash"; "claude" → engine only; "#high" at the end
 * is the reasoning effort asked for.
 */
export function splitRef(ref: ModelRef): { engine: string; model?: string; effort?: string } {
  const hash = ref.lastIndexOf("#");
  const effort = hash > 0 ? ref.slice(hash + 1) : "";
  const base = hash > 0 ? ref.slice(0, hash) : ref;
  const i = base.indexOf("/");
  const parts = i < 0 ? { engine: base } : { engine: base.slice(0, i), model: base.slice(i + 1) };
  return effort ? { ...parts, effort } : parts;
}

/** The ref without its effort: the model itself. */
export const baseRef = (ref: ModelRef): ModelRef => (ref.includes("#") ? ref.slice(0, ref.lastIndexOf("#")) : ref);
/** The same model with this effort (none: the model's own default). */
export const withEffort = (ref: ModelRef, effort: string | undefined): ModelRef =>
  effort ? `${baseRef(ref)}#${effort}` : baseRef(ref);

/** What the catalog says of a ref's model (its efforts among it); none for an engine alone or an unknown model. */
export function modelOf(ref: ModelRef, catalog: readonly CatalogEngine[]) {
  const { engine, model } = splitRef(ref);
  return model ? catalog.find((x) => x.id === engine)?.models.find((m) => m.id === model) : undefined;
}

/** Whether the catalog knows a ref (an engine alone, or one of its models). */
export function inCatalog(ref: ModelRef, catalog: readonly CatalogEngine[]): boolean {
  const { engine, model } = splitRef(ref);
  const e = catalog.find((x) => x.id === engine);
  return Boolean(e) && (!model || Boolean(e?.models.some((m) => m.id === model)));
}

/** A ref as people read it: an engine alone is "<Engine> default", a model stays its ref; its effort after a dot. */
export function refLabel(ref: ModelRef, catalog: readonly CatalogEngine[]): string {
  const { engine, model, effort } = splitRef(ref);
  const label = model
    ? baseRef(ref)
    : t("models.engineDefault", { engine: catalog.find((x) => x.id === engine)?.label ?? engine });
  return effort ? `${label} · ${effortLabel(effort)}` : label;
}

/** Short form for chips and summaries: an engine alone is just its label. */
function shortRef(ref: ModelRef, catalog: readonly CatalogEngine[]): string {
  const { engine, model, effort } = splitRef(ref);
  const label = model ? baseRef(ref) : (catalog.find((x) => x.id === engine)?.label ?? engine);
  return effort ? `${label} · ${effortLabel(effort)}` : label;
}

/**
 * What agents, the router and a chat may run on: model APIs that answer now (the plans signed in from APX among
 * them). Claude Code, Codex and ACP agents run only in their own sessions (DECISIONS.md#d-043).
 */
export const forAgents = (e: CatalogEngine): boolean => e.kind === "provider" && e.available;

/** A reasoning effort as people read it ("high" → "Alto"); one this panel does not know, capitalised. */
export function effortLabel(effort: string): string {
  const key = `models.effortLevel.${effort}`;
  return isKey(key) ? t(key) : effort.charAt(0).toUpperCase() + effort.slice(1);
}

/** A configured route, not a prediction of which candidate will answer a turn. */
export function choiceLabel(choice: ModelChoice, catalog: readonly CatalogEngine[], config?: ModelsConfig): string {
  if (!choice.model) {
    const first = config?.router.chain[0];
    return first
      ? t(config.router.rules.length ? "models.routerRulesFirst" : "models.routerFirst", {
          model: shortRef(first, catalog),
        })
      : t(config?.router.rules.length ? "models.routerRules" : "models.router");
  }
  const m = shortRef(choice.model, catalog);
  return choice.router ? t("models.withRouter", { model: m }) : m;
}

/** The picker keeps inheritance distinct from an explicit router or model choice. */
export function effectiveChoice(
  own: ModelChoice | null | undefined,
  inherited: ModelChoice | undefined,
  config: ModelsConfig | undefined,
): ModelChoice {
  return own ?? inherited ?? config?.default ?? { router: true };
}

/** What an agent runs on: the router, or its own model (with the router if it fails). */
export function agentChoiceLabel(
  choice: ModelChoice | undefined,
  config: ModelsConfig | undefined,
  catalog: readonly CatalogEngine[],
): string {
  return choiceLabel(effectiveChoice(choice, undefined, config), catalog, config);
}
