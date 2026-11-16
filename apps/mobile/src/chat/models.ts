import type { Key } from "../i18n/index.ts";

/** A model the catalog offers, as models.list returns each engine. */
export type CatalogEngine = {
  id: string;
  kind: "harness" | "provider";
  label: string;
  available: boolean;
  models: Array<{
    id: string;
    name: string;
    description?: string;
    chat: boolean;
    /** The reasoning efforts it takes, and the one it uses when none is asked for. */
    efforts?: string[];
    default_effort?: string;
  }>;
};
/** `fallbacks` are tried in order after `model` and before the router when it does not answer. */
export type ModelChoice = { model?: string; router: boolean; fallbacks?: string[] };
export type ModelOption = { ref: string; name: string; engine: string; efforts: string[]; defaultEffort?: string };
type Translate = (key: Key, vars?: Record<string, string | number>) => string;

/** "gemini/gemini-3.6-flash#high" → engine, model and effort (the panel's own reading of a ref). */
export function splitRef(ref: string): { engine: string; model?: string; effort?: string } {
  const hash = ref.lastIndexOf("#");
  const effort = hash > 0 ? ref.slice(hash + 1) : "";
  const base = hash > 0 ? ref.slice(0, hash) : ref;
  const i = base.indexOf("/");
  const parts = i < 0 ? { engine: base } : { engine: base.slice(0, i), model: base.slice(i + 1) };
  return effort ? { ...parts, effort } : parts;
}

/** The ref without its effort: the model itself. */
export const baseRef = (ref: string): string => (ref.includes("#") ? ref.slice(0, ref.lastIndexOf("#")) : ref);

const EFFORT_KEYS: Record<string, Key> = {
  none: "effortNone",
  minimal: "effortMinimal",
  low: "effortLow",
  medium: "effortMedium",
  high: "effortHigh",
  xhigh: "effortXhigh",
  max: "effortMax",
  ultra: "effortUltra",
};

/** A reasoning effort as people read it ("high" → "Alto"); one the phone does not know, capitalised. */
export function effortLabel(effort: string, tr: Translate): string {
  const key = EFFORT_KEYS[effort];
  return key ? tr(key) : effort.charAt(0).toUpperCase() + effort.slice(1);
}

/**
 * The efforts a model offers, as the panel's effort row lists them: its levels, plus "Its default" first when the
 * catalog names none. `value` "" asks for no effort.
 */
export function effortOptions(model: Pick<ModelOption, "efforts" | "defaultEffort">, tr: Translate) {
  const levels = model.efforts.map((e) => ({ value: e, label: effortLabel(e, tr) }));
  return model.defaultEffort || !levels.length ? levels : [{ value: "", label: tr("effortDefault") }, ...levels];
}

/** Which of a model's efforts a choice has on: its own, or the model's default when it asks for none. */
export function chosenEffort(choice: ModelChoice | undefined, model: Pick<ModelOption, "ref" | "defaultEffort">) {
  if (!choice?.model || baseRef(choice.model) !== model.ref) return undefined;
  return splitRef(choice.model).effort ?? model.defaultEffort ?? "";
}

/** The model with this effort, as the panel sends it; the model's own default travels as no effort at all. */
export function withEffort(ref: string, effort: string, defaultEffort?: string): string {
  return effort && effort !== defaultEffort ? `${baseRef(ref)}#${effort}` : baseRef(ref);
}

/** What a choice reads as on the chip: the model's ref (an engine alone is its label), or `router` when there is none. */
export function choiceText(choice: ModelChoice | undefined, catalog: CatalogEngine[], router: string): string {
  if (!choice?.model) return router;
  const { engine, model } = splitRef(choice.model);
  return model ? baseRef(choice.model) : (catalog.find((e) => e.id === engine)?.label ?? engine);
}

/** A choice's chip with its effort and fallbacks ("gpt-6 · High · 2 fallbacks"), as the panel's picker reads it. */
export function choiceLabel(
  choice: ModelChoice | undefined,
  catalog: CatalogEngine[],
  tr: Translate,
  router: string,
): string {
  const effort = choice?.model ? splitRef(choice.model).effort : undefined;
  const plain = choiceText(choice, catalog, router);
  const text = effort ? `${plain} · ${effortLabel(effort, tr)}` : plain;
  const n = choice?.model ? (choice.fallbacks?.length ?? 0) : 0;
  return n ? tr(choice?.router ? "modelWithFallbacksRouter" : "modelWithFallbacks", { model: text, n }) : text;
}

/**
 * The models a chat may switch to: a CLI's own session offers that CLI's models; any other chat, the model APIs that
 * answer now. A query matches a model's name or ref; without one each engine shows its first few.
 */
export function modelOptions(catalog: CatalogEngine[], engine: string | undefined, query = "", perEngine = 6) {
  const words = query.trim().toLowerCase();
  return catalog
    .filter((e) => (engine ? e.id === engine : e.kind === "provider" && e.available))
    .map((e) => {
      const models = e.models
        .filter((m) => m.chat)
        .map(
          (m): ModelOption => ({
            ref: `${e.id}/${m.id}`,
            name: m.name,
            engine: e.label,
            efforts: m.efforts ?? [],
            ...(m.default_effort ? { defaultEffort: m.default_effort } : {}),
          }),
        )
        .filter((m) => !words || `${m.name} ${m.ref}`.toLowerCase().includes(words));
      return { engine: e.label, models: words ? models : models.slice(0, perEngine) };
    })
    .filter((group) => group.models.length > 0);
}
