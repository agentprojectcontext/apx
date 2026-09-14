import { useMemo } from "react";
import useSWR from "swr";
import { Admin } from "../../lib/api/admin";
import { Engines } from "../../lib/api/engines";
import { useProviderModels } from "../../hooks/useProviderModels";

/** One configured provider plus the models we can offer for it. */
export interface CatalogProvider {
  slug: string;
  /** Adapter behind the slug (`ollama`, `openai`…). Defaults to the slug. */
  engine: string;
  name: string;
  defaultModel: string;
  /** `default_model` first, then whatever the provider itself lists. */
  models: string[];
  /** The list came from the provider on this pass, not from a cache or presets. */
  live: boolean;
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
 * The models this install can actually offer, grouped by provider.
 *
 * Only ACTIVE providers in `config.engines`: offering a model from a provider
 * whose switch is off produces a turn that cannot run.
 *
 * Where the models come from, in order:
 *   1. the provider itself, asked through the daemon (useProviderModels);
 *   2. the last list we cached for it, when it does not answer right now;
 *   3. the curated `known_models` of its engine (core/engines/presets.js),
 *      which is the documented OFFLINE fallback — and is empty for Ollama by
 *      design, since that catalog only exists on the machine.
 *
 * Live and curated are alternatives, never a union: a provider that just told
 * us what it serves should not also be offered ids it did not mention.
 *
 * `enabled: false` skips the network probe — for pickers that should only reach
 * out once the user opens them. Config and presets are daemon-local and shared
 * through SWR, so several pickers on screen still cost one fetch each.
 */
export function useModelCatalog({ enabled = true }: { enabled?: boolean } = {}) {
  const cfg = useSWR("/api/admin/config", () => Admin.config.get());
  const presets = useSWR("/api/engines/presets", () => Engines.presets());

  const targets = useMemo(() => {
    const engines = cfg.data?.config?.engines ?? {};
    return Object.entries(engines)
      .filter(([, prov]) => prov?.is_active !== false)
      .map(([slug, prov]) => ({ slug, engine: prov?.engine || slug, base_url: prov?.base_url }));
  }, [cfg.data]);

  const live = useProviderModels(targets, enabled);

  const providers = useMemo<CatalogProvider[]>(() => {
    const engines = cfg.data?.config?.engines ?? {};
    const catalog = presets.data?.presets ?? {};
    const out: CatalogProvider[] = [];
    for (const [slug, prov] of Object.entries(engines)) {
      if (prov?.is_active === false) continue;
      const engine = prov?.engine || slug;
      const probed = live.models[slug] ?? [];
      const models: string[] = [];
      for (const m of [
        ...(prov?.default_model ? [prov.default_model] : []),
        ...(probed.length ? probed : (catalog[engine]?.known_models ?? [])),
      ]) {
        if (m && !models.includes(m)) models.push(m);
      }
      out.push({
        slug,
        engine,
        name: prov?.name || slug,
        defaultModel: prov?.default_model || "",
        models,
        live: live.online[slug] === true,
      });
    }
    return out;
  }, [cfg.data, presets.data, live.models, live.online]);

  return {
    providers,
    loading: cfg.isLoading || presets.isLoading,
    /** A live pass is in flight; `providers` already holds the cached answer. */
    probing: live.probing,
  };
}
