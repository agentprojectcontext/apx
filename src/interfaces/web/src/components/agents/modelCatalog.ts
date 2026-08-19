import { useMemo } from "react";
import useSWR from "swr";
import { Admin } from "../../lib/api/admin";
import { Engines } from "../../lib/api/engines";

/** One configured provider plus the models we can offer for it. */
export interface CatalogProvider {
  slug: string;
  name: string;
  defaultModel: string;
  /** `default_model` first, then the engine's curated known_models. */
  models: string[];
}

// A model id is `<provider>:<model>` and the model half can hold colons of its
// own (ollama:gemma2:9b), so only the first one separates.
export function splitModelId(id: string): { provider: string; model: string } {
  const i = id.indexOf(":");
  return i < 0 ? { provider: "", model: id } : { provider: id.slice(0, i), model: id.slice(i + 1) };
}

/**
 * What the UI writes for "no forced model". The daemon accepts an absent field
 * too, but `inherit` is APC's documented marker and keeps the agent file
 * self-explanatory — core/agent/agent-model.js resolves both to the router.
 */
export const INHERIT_MODEL = "inherit";

// No override: either nothing stored, or the `inherit` marker.
export function isInheritedModel(model?: string | null): boolean {
  return !model || model.trim().toLowerCase() === INHERIT_MODEL;
}

/**
 * The models this install can actually offer, grouped by provider: for every
 * active provider in `config.engines`, its default model plus the curated
 * known_models of its engine (source of truth: core/engines/presets.js).
 *
 * Both requests are plain SWR keys shared app-wide, so several pickers on
 * screen cost one fetch each.
 */
export function useModelCatalog() {
  const cfg = useSWR("/api/admin/config", () => Admin.config.get());
  const presets = useSWR("/api/engines/presets", () => Engines.presets());

  const providers = useMemo<CatalogProvider[]>(() => {
    const engines = cfg.data?.config?.engines ?? {};
    const catalog = presets.data?.presets ?? {};
    const out: CatalogProvider[] = [];
    for (const [slug, prov] of Object.entries(engines)) {
      if (prov?.is_active === false) continue;
      const engine = prov?.engine || slug;
      const models: string[] = [];
      for (const m of [
        ...(prov?.default_model ? [prov.default_model] : []),
        ...(catalog[engine]?.known_models ?? []),
      ]) {
        if (!models.includes(m)) models.push(m);
      }
      out.push({ slug, name: prov?.name || slug, defaultModel: prov?.default_model || "", models });
    }
    return out;
  }, [cfg.data, presets.data]);

  return { providers, loading: cfg.isLoading || presets.isLoading };
}
