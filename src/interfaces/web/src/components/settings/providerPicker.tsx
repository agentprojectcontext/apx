// The "which provider, which model" control, shared by every screen that edits
// a model chain — the global router in Settings and the per-project one.
//
// It lives here rather than inside DefaultRouterCard because the project screen
// asks the same question of a different config layer, and a second copy of this
// logic is a second place for "is this provider actually reachable" to drift.
import { useMemo } from "react";
import { Combobox, type ComboOption } from "../Combobox";
import { ModelCombobox } from "../ModelCombobox";
import { ENGINE_ICONS, ENGINE_PRESETS, engineStyle, type EngineType } from "./providers/typeStyles";
import { t } from "../../i18n";

export interface ProviderInfo {
  slug: string;
  engine: EngineType;
  label: string;
  base_url?: string;
  default_model?: string;
  /** is_active in config.engines — the switch on the provider card. */
  active: boolean;
  /**
   * Has what it needs to ATTEMPT a call: an api key, unless the engine ships
   * its own (Ollama needs none, Zen defaults to "public"). A provider that is
   * not configured can never answer, so it is the one thing besides the switch
   * that makes it unpickable.
   */
  configured: boolean;
  /**
   * Answered the last live probe. Only Ollama is probed today; everything else
   * reports `true` because there is nothing cheap to ask.
   *
   * This must NEVER gate selection. A server that is down, a rate limit, a
   * monthly budget — all of them are circumstantial and most of them come back
   * on their own, and the whole point of a fallback chain is to hold entries
   * that are not answering right now. Surfacing it as a warning is right;
   * refusing to let the user place the row is not.
   */
  reachable: boolean;
}

export type EngineEntry = {
  engine?: string;
  name?: string;
  default_model?: string;
  base_url?: string;
  api_key?: string;
  is_active?: boolean;
};

/** Why a row cannot be used, or null when it is fine. */
export type RowProblem = "missing" | "off" | "unconfigured" | "unreachable" | null;

export function splitRef(ref: string): { provider: string; model: string } {
  const i = ref.indexOf(":");
  if (i < 0) return { provider: ref, model: "" };
  return { provider: ref.slice(0, i), model: ref.slice(i + 1) };
}

export function rowProblem(providerSlug: string, providers: ProviderInfo[]): RowProblem {
  if (!providerSlug) return null;
  const p = providers.find((x) => x.slug === providerSlug);
  if (!p) return "missing";
  if (!p.active) return "off";
  if (!p.configured) return "unconfigured";
  if (!p.reachable) return "unreachable";
  return null;
}

export function problemHint(problem: RowProblem, name: string): string {
  if (problem === "missing") return t("router_panel.provider_not_configured", { name });
  if (problem === "off") return t("router_panel.provider_off", { name });
  if (problem === "unconfigured") return t("router_panel.provider_unconfigured", { name });
  if (problem === "unreachable") return t("router_panel.provider_unreachable", { name });
  return "";
}

/** Which engine slugs in a config map are Ollama, and where each one lives. */
export function ollamaTargetsOf(engines: Record<string, EngineEntry>) {
  return Object.entries(engines)
    .filter(([slug, v]) => ((v?.engine as EngineType) || (slug as EngineType)) === "ollama")
    .map(([slug, v]) => ({ slug, base_url: v?.base_url }));
}

/** Turn a `config.engines` map into the list the pickers render. */
export function providersFromEngines(
  engines: Record<string, EngineEntry>,
  // `undefined` for a target still being probed — see `connected` below.
  ollamaOnline: Record<string, boolean | undefined>,
): ProviderInfo[] {
  return Object.entries(engines).map(([slug, v]) => {
    const engine = ((v?.engine as EngineType) || (slug as EngineType));
    const name = v?.name || slug;
    const hasKey = typeof v?.api_key === "string" && v.api_key.length > 0;
    // Ollama/mock/custom need no key; for Ollama we know whether the server
    // actually answered. `undefined` = still probing → assume reachable so the
    // list does not flicker to "offline" on first paint.
    // Two different questions, kept apart on purpose.
    //
    // configured: could this provider be called at all? Engines that ship
    // their own credential (Ollama, Zen, mock — `key_optional` in the shared
    // catalog) are always configured; `custom` needs a key or a base_url to
    // point anywhere; everything else needs a key.
    const keyOptional = ENGINE_PRESETS[engine]?.key_optional === true;
    const configured =
      keyOptional ? true
      : engine === "custom" ? hasKey || !!v?.base_url
      : hasKey;
    // reachable: did it answer the last probe? `undefined` = still probing →
    // assume yes so the list does not flicker on first paint.
    const reachable = engine === "ollama" ? ollamaOnline[slug] !== false : true;
    return {
      slug,
      engine,
      label: name === engine ? name : `${name} (${engine})`,
      base_url: v?.base_url,
      default_model: v?.default_model,
      active: v?.is_active !== false,
      configured,
      reachable,
    };
  });
}

// Provider combobox + model combobox. Serializes to "provider:model".
// Both sides accept free text: providers are a fixed list you normally pick
// from, but a slug that is not configured (yet) must stay typeable.
export function ProviderModelPicker({
  value,
  onChange,
  providers,
  ollamaModels,
}: {
  value: string;
  onChange: (ref: string) => void;
  providers: ProviderInfo[];
  ollamaModels: Record<string, string[]>;
}) {
  const { provider, model } = splitRef(value);
  const current = providers.find((p) => p.slug === provider);
  const problem = rowProblem(provider, providers);

  const providerOptions: ComboOption[] = useMemo(
    () => providers.map((p) => ({
      value: p.slug,
      label: p.label,
      // engineStyle falls back to the generic icon for an adapter this build
      // does not know about yet.
      icon: engineStyle(ENGINE_ICONS, p.engine),
      // Only the two states the USER controls make a provider unpickable:
      // switched off, or never configured. Anything circumstantial — the
      // Ollama box asleep, a rate limit, an exhausted monthly budget — stays
      // selectable and merely warns, because a fallback chain exists precisely
      // to hold entries that are not answering at this second.
      disabled: !p.active || !p.configured,
      hint: !p.active ? t("router_panel.hint_off")
        : !p.configured ? t("router_panel.hint_unconfigured")
        : !p.reachable ? t("router_panel.hint_unreachable")
        : undefined,
    })),
    [providers],
  );

  const isOllama = current?.engine === "ollama";
  const modelOptions = useMemo(() => {
    if (!current) return [];
    // Ollama's catalog is whatever that machine pulled — always live/cached.
    if (isOllama) return ollamaModels[current.slug] || [];
    const known = ENGINE_PRESETS[current.engine]?.known_models || [];
    return Array.from(new Set([...(current.default_model ? [current.default_model] : []), ...known]));
  }, [current, isOllama, ollamaModels]);

  // Pre-fill the model when a provider is picked: its own default, else the
  // engine's. Never the engine default for Ollama — that machine only has what
  // it pulled, so the first live model is the only honest guess.
  const setProvider = (slug: string) => {
    const p = providers.find((x) => x.slug === slug);
    const m = p?.default_model
      || (p?.engine === "ollama"
        ? (ollamaModels[slug] || [])[0] || ""
        : ENGINE_PRESETS[p?.engine as EngineType]?.default_model || "");
    onChange(m ? `${slug}:${m}` : `${slug}:`);
  };

  return (
    <div className="grid grid-cols-2 gap-2">
      <Combobox
        value={provider}
        onChange={(slug) => onChange(`${slug}:${model}`)}
        onPick={setProvider}
        options={providerOptions}
        placeholder={t("router_panel.provider_ph")}
        invalid={!!provider && !!problem}
        invalidHint={problemHint(problem, provider)}
        emptyHint={t("router_panel.no_providers")}
      />
      <ModelCombobox
        value={model}
        onChange={(m) => onChange(`${provider}:${m}`)}
        options={modelOptions}
        emptyHint={isOllama ? t("router_panel.ollama_empty") : undefined}
      />
    </div>
  );
}
