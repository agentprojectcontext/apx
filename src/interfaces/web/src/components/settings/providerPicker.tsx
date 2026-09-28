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
import { EffortChips, carryEffort, splitEffort, withEffort } from "../agents/modelEffort";
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
   * Answered the last live probe. Every active provider is probed for its
   * model list, but only Ollama's answer decides this; everything else reports
   * `true` — a failed listing does not mean a failed turn.
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

/**
 * Every active provider in a config map, shaped for the live model probe.
 *
 * Only Ollama used to be probed here, so the chain editors offered the curated
 * `known_models` for everyone else while the chat picker (useModelCatalog)
 * already listed what the provider actually serves — gpt-6 showed up in one
 * and not in the other. Switched-off providers are skipped: they are
 * unpickable anyway, and probing them is a request for nothing.
 */
export function providerTargetsOf(engines: Record<string, EngineEntry>) {
  return Object.entries(engines)
    .filter(([, v]) => v?.is_active !== false)
    .map(([slug, v]) => ({ slug, engine: v?.engine || slug, base_url: v?.base_url }));
}

/** Turn a `config.engines` map into the list the pickers render. */
export function providersFromEngines(
  engines: Record<string, EngineEntry>,
  // `undefined` for a target still being probed — see `reachable` below.
  online: Record<string, boolean | undefined>,
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
    // assume yes so the list does not flicker on first paint. Only Ollama's
    // answer counts: a cloud provider whose model listing fails (a scoped key,
    // a plan without /models) can still run turns, so it must not warn.
    const reachable = engine === "ollama" ? online[slug] !== false : true;
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

/**
 * The models a chain row offers for its provider. Same rule as the chat picker
 * (useModelCatalog): what the provider lists live wins, and the curated
 * `known_models` are only the offline fallback — never a union with it. Ollama
 * has no curated list: that machine only has what it pulled.
 */
export function modelOptionsFor(
  current: ProviderInfo | undefined,
  liveModels: Record<string, string[]>,
): string[] {
  if (!current) return [];
  const live = liveModels[current.slug] || [];
  if (current.engine === "ollama") return live;
  const list = live.length ? live : ENGINE_PRESETS[current.engine]?.known_models || [];
  return Array.from(new Set([...(current.default_model ? [current.default_model] : []), ...list]));
}

// Provider combobox + model combobox. Serializes to "provider:model".
// Both sides accept free text: providers are a fixed list you normally pick
// from, but a slug that is not configured (yet) must stay typeable.
export function ProviderModelPicker({
  value,
  onChange,
  providers,
  liveModels,
}: {
  value: string;
  onChange: (ref: string) => void;
  providers: ProviderInfo[];
  /** Per provider slug: what it listed live, or the last list cached for it. */
  liveModels: Record<string, string[]>;
}) {
  // The effort rides on the stored id as `@<effort>`; it is edited on its own
  // control, never inside the model box.
  const { base, effort } = splitEffort(value);
  const { provider, model } = splitRef(base);
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
  const modelOptions = useMemo(() => modelOptionsFor(current, liveModels), [current, liveModels]);

  // Pre-fill the model when a provider is picked: its own default, else the
  // engine's. Never the engine default for Ollama — that machine only has what
  // it pulled, so the first live model is the only honest guess.
  const setProvider = (slug: string) => {
    const p = providers.find((x) => x.slug === slug);
    const m = p?.default_model
      || (p?.engine === "ollama"
        ? (liveModels[slug] || [])[0] || ""
        : ENGINE_PRESETS[p?.engine as EngineType]?.default_model || "");
    onChange(m ? carryEffort(`${slug}:${m}`, effort, p?.engine) : `${slug}:`);
  };

  return (
    <div className="flex flex-col gap-2">
    <div className="grid grid-cols-2 gap-2">
      <Combobox
        value={provider}
        onChange={(slug) => onChange(carryEffort(`${slug}:${model}`, effort, providers.find((x) => x.slug === slug)?.engine))}
        onPick={setProvider}
        options={providerOptions}
        placeholder={t("router_panel.provider_ph")}
        invalid={!!provider && !!problem}
        invalidHint={problemHint(problem, provider)}
        emptyHint={t("router_panel.no_providers")}
      />
      <ModelCombobox
        value={model}
        onChange={(m) => onChange(withEffort(`${provider}:${m}`, effort))}
        options={modelOptions}
        emptyHint={isOllama ? t("router_panel.ollama_empty") : undefined}
      />
    </div>
    {model && <EffortChips engine={current?.engine} value={effort} onChange={(e) => onChange(withEffort(base, e))} />}
    </div>
  );
}
