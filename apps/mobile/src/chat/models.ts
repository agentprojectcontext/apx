/** A model the catalog offers, as models.list returns each engine. */
export type CatalogEngine = {
  id: string;
  kind: "harness" | "provider";
  label: string;
  available: boolean;
  models: Array<{ id: string; name: string; description?: string; chat: boolean }>;
};
export type ModelChoice = { model?: string; router: boolean };
export type ModelOption = { ref: string; name: string; engine: string };

/** "gemini/gemini-3.6-flash#high" → engine, model and effort (the panel's own reading of a ref). */
export function splitRef(ref: string): { engine: string; model?: string; effort?: string } {
  const hash = ref.lastIndexOf("#");
  const effort = hash > 0 ? ref.slice(hash + 1) : "";
  const base = hash > 0 ? ref.slice(0, hash) : ref;
  const i = base.indexOf("/");
  const parts = i < 0 ? { engine: base } : { engine: base.slice(0, i), model: base.slice(i + 1) };
  return effort ? { ...parts, effort } : parts;
}

/** What a choice reads as on the chip: the model's ref (an engine alone is its label), or `router` when there is none. */
export function choiceText(choice: ModelChoice | undefined, catalog: CatalogEngine[], router: string): string {
  if (!choice?.model) return router;
  const { engine, model } = splitRef(choice.model);
  return model ? choice.model.replace(/#.*$/, "") : (catalog.find((e) => e.id === engine)?.label ?? engine);
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
        .map((m): ModelOption => ({ ref: `${e.id}/${m.id}`, name: m.name, engine: e.label }))
        .filter((m) => !words || `${m.name} ${m.ref}`.toLowerCase().includes(words));
      return { engine: e.label, models: words ? models : models.slice(0, perEngine) };
    })
    .filter((group) => group.models.length > 0);
}
