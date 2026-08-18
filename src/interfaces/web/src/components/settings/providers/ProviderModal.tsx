import { useEffect, useMemo, useState } from "react";
import { Braces, Loader2, RefreshCw, SlidersHorizontal } from "lucide-react";
import { Button, Dialog, Field, Input, Switch, Textarea } from "../../ui";
import { Tip } from "../../ui/tip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../ui/tabs";
import { UiSelect } from "../../UiSelect";
import { ModelCombobox } from "../../ModelCombobox";
import { Engines } from "../../../lib/api";
import { isSecretMarker, secretSuffix } from "../../../lib/secrets";
import { ENGINE_ICONS, ENGINE_OPTIONS, ENGINE_PRESETS, type EngineType } from "./typeStyles";
import type { Provider } from "./types";
import { t } from "../../../i18n";
import { toneText } from "../../../lib/tone";

export interface ProviderSaveResult {
  provider: Provider;
  apiKeyValue?: string; // only set when the user typed a new key
  originalSlug?: string;
  raw?: Record<string, unknown>; // set in JSON mode: full engines.<slug> block
}

interface Props {
  open: boolean;
  initial: Provider | null; // null = create
  existingSlugs: string[];
  onClose: () => void;
  onSave: (r: ProviderSaveResult) => Promise<void>;
}

interface FormState {
  name: string;
  slug: string;
  engine: EngineType;
  base_url: string;
  api_key_value: string;
  default_model: string;
  default_temperature: number;
  default_max_tokens: number;
  is_active: boolean;
  thinking: boolean;
  context_limit_tokens: number;
  model_context_limits_json: string;
  p_input: string;
  p_output: string;
  p_cache_read: string;
  p_cache_write: string;
}

const EMPTY: FormState = {
  name: "", slug: "", engine: "anthropic", base_url: "", api_key_value: "",
  default_model: "", default_temperature: 0.7, default_max_tokens: 4096,
  is_active: true, thinking: true, context_limit_tokens: 200000, model_context_limits_json: "",
  p_input: "", p_output: "", p_cache_read: "", p_cache_write: "",
};

// Preset pills shown on create (the common providers).
function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function numOrEmpty(v: unknown): string {
  if (v === null || v === undefined) return "";
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : "";
}

function fromProvider(p: Provider): FormState {
  return {
    name: p.name || p.slug,
    slug: p.slug,
    engine: (p.engine as EngineType) || "custom",
    base_url: p.base_url || "",
    api_key_value: "",
    default_model: p.default_model || "",
    default_temperature: p.default_temperature ?? 0.7,
    default_max_tokens: p.default_max_tokens ?? 4096,
    is_active: p.is_active !== false,
    thinking: p.thinking !== false,
    context_limit_tokens: p.context_limit_tokens ?? 200000,
    model_context_limits_json: p.model_context_limits ? JSON.stringify(p.model_context_limits, null, 2) : "",
    p_input: numOrEmpty(p.pricing?.input_per_million),
    p_output: numOrEmpty(p.pricing?.output_per_million),
    p_cache_read: numOrEmpty(p.pricing?.cache_read_per_million),
    p_cache_write: numOrEmpty(p.pricing?.cache_write_per_million),
  };
}

export function ProviderModal({ open, initial, existingSlugs, onClose, onSave }: Props) {
  const isEdit = !!initial;
  const [f, setF] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);

  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState("");

  useEffect(() => {
    if (!open) return;
    const init = initial ? fromProvider(initial) : EMPTY;
    setF(init);
    setError(null);
    setModelError(null);
    setJsonMode(false);
    const preset = ENGINE_PRESETS[init.engine];
    setAvailableModels(preset?.known_models || []);
  }, [open, initial]);

  const up = (patch: Partial<FormState>) => setF((s) => ({ ...s, ...patch }));

  // Picking an engine applies its whole preset — endpoint, default model, model
  // list. There used to be two ways to do this (a pill row and this select)
  // that disagreed: the pills overwrote the endpoint, the select only filled it
  // when empty, so the same choice left you in different states depending on
  // where you clicked. One control now, and it fills the endpoint.
  //
  // A base_url the user typed themselves is never clobbered: only a blank, or
  // one still carrying another engine's preset value, gets replaced. Same rule
  // for the default model, so switching engine to compare two providers doesn't
  // quietly discard what you configured.
  const isUntouched = (value: string, field: "base_url" | "default_model") =>
    !value || Object.values(ENGINE_PRESETS).some((preset) => preset[field] && preset[field] === value);

  const changeEngine = (engine: EngineType) => {
    const p = ENGINE_PRESETS[engine];
    const patch: Partial<FormState> = { engine };
    if (isUntouched(f.base_url, "base_url")) patch.base_url = p.base_url;
    if (isUntouched(f.default_model, "default_model")) patch.default_model = p.default_model;
    // On create the provider is also named after the engine; an existing one
    // keeps the name it is referred to by.
    if (!isEdit && engine !== "custom") {
      patch.name = ENGINE_OPTIONS.find((o) => o.value === engine)?.label || engine;
      patch.slug = engine;
    }
    up(patch);
    setAvailableModels(p.known_models);
    setModelError(null);
  };

  const loadModels = async () => {
    setLoadingModels(true);
    setModelError(null);
    try {
      const r = await Engines.models({
        engine: f.engine,
        slug: f.slug || slugify(f.name),
        base_url: f.base_url || undefined,
        api_key: f.api_key_value || undefined, // typed key for unsaved providers
      });
      if (r.error) { setModelError(r.error); return; }
      setAvailableModels(r.models);
      if (r.models.length === 0) setModelError(t("providers_modal.err_no_models"));
    } catch (e) {
      setModelError((e as Error).message || t("providers_modal.err_list_models"));
    } finally { setLoadingModels(false); }
  };

  const modelOptions = useMemo(() => (
    f.default_model && !availableModels.includes(f.default_model)
      ? [f.default_model, ...availableModels]
      : availableModels
  ), [availableModels, f.default_model]);

  const buildProvider = (): { provider: Provider; modelLimits?: Record<string, number> } | null => {
    const slug = (f.slug || slugify(f.name)).trim();
    if (!slug) { setError(t("providers_modal.err_slug_required")); return null; }
    if (!isEdit && existingSlugs.includes(slug)) { setError(t("providers_modal.err_slug_exists", { slug })); return null; }

    let modelLimits: Record<string, number> | undefined;
    if (f.model_context_limits_json.trim()) {
      try {
        const parsed = JSON.parse(f.model_context_limits_json);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
        modelLimits = parsed;
      } catch { setError(t("providers_modal.err_model_limits_json")); return null; }
    }

    const pricingVals = [f.p_input, f.p_output, f.p_cache_read, f.p_cache_write].map((x) => x.trim());
    const pricing = pricingVals.some(Boolean)
      ? {
          input_per_million: Number(f.p_input || 0),
          output_per_million: Number(f.p_output || 0),
          cache_read_per_million: Number(f.p_cache_read || 0),
          cache_write_per_million: Number(f.p_cache_write || 0),
        }
      : undefined;

    return {
      provider: {
        slug,
        name: f.name.trim() || slug,
        engine: f.engine,
        base_url: f.base_url.trim() || undefined,
        default_model: f.default_model.trim() || undefined,
        default_temperature: f.default_temperature,
        default_max_tokens: f.default_max_tokens,
        is_active: f.is_active,
        thinking: f.thinking,
        context_limit_tokens: f.context_limit_tokens || undefined,
        model_context_limits: modelLimits,
        pricing,
      },
      modelLimits,
    };
  };

  // Switch to JSON mode: serialize the current form to a config.engines block.
  const enterJsonMode = () => {
    const built = buildProvider();
    if (!built) return;
    const { provider } = built;
    const block: Record<string, unknown> = {
      name: provider.name,
      engine: provider.engine,
      is_active: provider.is_active !== false,
      default_temperature: provider.default_temperature,
      default_max_tokens: provider.default_max_tokens,
    };
    if (provider.base_url) block.base_url = provider.base_url;
    if (provider.default_model) block.default_model = provider.default_model;
    if (provider.context_limit_tokens) block.context_limit_tokens = provider.context_limit_tokens;
    if (provider.model_context_limits) block.model_context_limits = provider.model_context_limits;
    if (provider.pricing) block.pricing = provider.pricing;
    if (f.api_key_value.trim()) block.api_key = f.api_key_value.trim();
    setJsonText(JSON.stringify(block, null, 2));
    setError(null);
    setJsonMode(true);
  };

  // Leaving the JSON tab: parse it back into the form so edits made there are
  // not silently dropped. Returns false (and shows why) when it cannot, so the
  // caller can keep the user on the JSON tab with their text intact.
  const applyJsonToForm = (): boolean => {
    let parsed: unknown;
    try { parsed = JSON.parse(jsonText); }
    catch { setError(t("providers_modal.err_json_invalid")); return false; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setError(t("providers_modal.err_json_object")); return false;
    }
    const raw = parsed as Record<string, unknown>;
    const str = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : undefined);
    const num = (k: string) => (typeof raw[k] === "number" ? (raw[k] as number) : undefined);
    const pricing = (raw.pricing || {}) as Record<string, unknown>;
    const engine = str("engine") as EngineType | undefined;
    setF((s) => ({
      ...s,
      name: str("name") ?? s.name,
      engine: engine ?? s.engine,
      base_url: str("base_url") ?? "",
      default_model: str("default_model") ?? "",
      api_key_value: str("api_key") ?? s.api_key_value,
      default_temperature: num("default_temperature") ?? s.default_temperature,
      default_max_tokens: num("default_max_tokens") ?? s.default_max_tokens,
      is_active: raw.is_active !== false,
      context_limit_tokens: num("context_limit_tokens") ?? s.context_limit_tokens,
      model_context_limits_json: raw.model_context_limits ? JSON.stringify(raw.model_context_limits, null, 2) : "",
      p_input: numOrEmpty(pricing.input_per_million),
      p_output: numOrEmpty(pricing.output_per_million),
      p_cache_read: numOrEmpty(pricing.cache_read_per_million),
      p_cache_write: numOrEmpty(pricing.cache_write_per_million),
    }));
    if (engine) setAvailableModels(ENGINE_PRESETS[engine]?.known_models || []);
    setError(null);
    return true;
  };

  const switchTab = (tab: string) => {
    if (tab === "json") { enterJsonMode(); return; }
    if (applyJsonToForm()) setJsonMode(false);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (jsonMode) {
        const slug = (f.slug || slugify(f.name)).trim();
        if (!slug) { setError(t("providers_modal.err_slug_required_form")); return; }
        let parsed: unknown;
        try { parsed = JSON.parse(jsonText); }
        catch { setError(t("providers_modal.err_json_invalid")); return; }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          setError(t("providers_modal.err_json_object")); return;
        }
        const raw = parsed as Record<string, unknown>;
        if (!raw.engine || typeof raw.engine !== "string") {
          setError(t("providers_modal.err_engine_missing")); return;
        }
        const provider: Provider = {
          slug,
          name: typeof raw.name === "string" ? raw.name : slug,
          engine: String(raw.engine),
          base_url: typeof raw.base_url === "string" ? raw.base_url : undefined,
          default_model: typeof raw.default_model === "string" ? raw.default_model : undefined,
          is_active: raw.is_active !== false,
        };
        await onSave({ provider, raw, originalSlug: initial?.slug });
        onClose();
        return;
      }

      const built = buildProvider();
      if (!built) return;
      await onSave({ provider: built.provider, apiKeyValue: f.api_key_value.trim() || undefined, originalSlug: initial?.slug });
      onClose();
    } catch (e) {
      setError((e as Error).message || t("providers_modal.err_save"));
    } finally { setBusy(false); }
  };

  const existingKey = isEdit && isSecretMarker(initial?.api_key);
  const keySuffix = secretSuffix(initial?.api_key);
  const keyPlaceholder = existingKey ? t("providers_modal.api_key_set", { suffix: keySuffix ?? "" }) : "sk-…";
  const isOllama = f.engine === "ollama";
  const apiKeyEnv = ENGINE_PRESETS[f.engine]?.api_key_env;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? t("providers_modal.edit_title", { name: initial?.name || initial?.slug || "" }) : t("providers_modal.new_title")}
      description={t("providers_modal.description")}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={submit} loading={busy}>{isEdit ? t("common.save") : t("common.create")}</Button>
        </>
      }
    >
      <Tabs value={jsonMode ? "json" : "form"} onValueChange={(v) => switchTab(String(v))} className="gap-3">
        <TabsList>
          <TabsTrigger value="form">
            <SlidersHorizontal className="size-3.5" /> {t("providers_modal.tab_form")}
          </TabsTrigger>
          <TabsTrigger value="json">
            <Braces className="size-3.5" /> {t("providers_modal.tab_json")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="json">
          <div className="space-y-2">
            <Field label={t("providers_modal.json_label")} hint={t("providers_modal.json_hint", { slug: (f.slug || slugify(f.name)) || "<slug>" })}>
              <Textarea
                rows={14}
                className="font-mono text-xs"
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                spellCheck={false}
              />
            </Field>
            <p className="text-[11px] text-muted-fg">{t("providers_modal.json_help")}</p>
          </div>
        </TabsContent>

        <TabsContent value="form">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("providers_modal.name_label")}>
                <Input value={f.name} onChange={(e) => up({ name: e.target.value, slug: isEdit ? f.slug : slugify(e.target.value) })} placeholder={t("providers_modal.name_ph")} />
              </Field>
              <Field label={t("providers_modal.engine_label")}>
                <UiSelect
                  value={f.engine}
                  onChange={(v) => changeEngine(v as EngineType)}
                  options={ENGINE_OPTIONS.map((o) => ({ value: o.value, label: o.label, icon: ENGINE_ICONS[o.value] }))}
                />
              </Field>
            </div>

            <Field label={t("providers_modal.base_url_label")} hint={t("providers_modal.base_url_hint")}>
              <Input value={f.base_url} onChange={(e) => up({ base_url: e.target.value })} placeholder={t("providers_modal.base_url_ph")} />
            </Field>

            {!isOllama && (
              <Field label={t("providers_modal.api_key_label")} hint={existingKey ? t("providers_modal.api_key_hint_existing") : apiKeyEnv ? t("providers_modal.api_key_hint_env", { env: apiKeyEnv }) : t("providers_modal.api_key_hint")}>
                <Input type="password" autoComplete="new-password" value={f.api_key_value} onChange={(e) => up({ api_key_value: e.target.value })} placeholder={keyPlaceholder} />
              </Field>
            )}

            <Field label={t("providers_modal.model_label")}>
              <div className="space-y-2">
                <div className="flex items-start gap-2">
                  <ModelCombobox
                    value={f.default_model}
                    onChange={(v) => up({ default_model: v })}
                    options={modelOptions}
                    className="flex-1"
                  />
                  <Tip content={t("providers_modal.list_models_hint")}>
                    <Button size="sm" variant="secondary" onClick={loadModels} disabled={loadingModels} aria-label={t("providers_modal.list_models_hint")}>
                      {loadingModels ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                      {t("providers_modal.load_models")}
                    </Button>
                  </Tip>
                </div>
                {modelError && <p className={`text-[11px] ${toneText.amber}`}>{modelError}</p>}
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label={t("providers_modal.max_tokens_label")}><Input type="number" min={256} step={256} value={f.default_max_tokens} onChange={(e) => up({ default_max_tokens: parseInt(e.target.value) || 4096 })} /></Field>
              <Field label={t("providers_modal.temperature_label", { value: f.default_temperature.toFixed(1) })}>
                <input type="range" min={0} max={2} step={0.1} value={f.default_temperature} onChange={(e) => up({ default_temperature: parseFloat(e.target.value) })} className="mt-2 w-full accent-foreground" />
              </Field>
            </div>

            <details className="rounded-md border border-border bg-muted/20 p-3">
              <summary className="cursor-pointer text-xs font-medium text-muted-fg">{t("providers_modal.pricing_summary")}</summary>
              <div className="mt-3 space-y-3">
                <Field label={t("providers_modal.context_limit_label")}><Input type="number" min={0} step={1024} value={f.context_limit_tokens} onChange={(e) => up({ context_limit_tokens: parseInt(e.target.value) || 0 })} /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t("providers_modal.price_input")}><Input type="number" min={0} step={0.0001} value={f.p_input} onChange={(e) => up({ p_input: e.target.value })} placeholder="0.15" /></Field>
                  <Field label={t("providers_modal.price_output")}><Input type="number" min={0} step={0.0001} value={f.p_output} onChange={(e) => up({ p_output: e.target.value })} placeholder="0.60" /></Field>
                  <Field label={t("providers_modal.price_cache_read")}><Input type="number" min={0} step={0.0001} value={f.p_cache_read} onChange={(e) => up({ p_cache_read: e.target.value })} placeholder="0.03" /></Field>
                  <Field label={t("providers_modal.price_cache_write")}><Input type="number" min={0} step={0.0001} value={f.p_cache_write} onChange={(e) => up({ p_cache_write: e.target.value })} placeholder="0.00" /></Field>
                </div>
                <Field label={t("providers_modal.model_limits_label")} hint='{"gpt-4o-mini":128000}'>
                  <Textarea rows={3} className="font-mono text-xs" value={f.model_context_limits_json} onChange={(e) => up({ model_context_limits_json: e.target.value })} />
                </Field>
              </div>
            </details>

            <Switch checked={f.is_active} onChange={(v) => up({ is_active: v })} label={t("providers_modal.active_label")} />
            <div className="space-y-1">
              <Switch checked={f.thinking} onChange={(v) => up({ thinking: v })} label={t("providers_modal.thinking_label")} />
              <p className="text-xs text-muted-fg">{t("providers_modal.thinking_hint")}</p>
            </div>
          </div>
        </TabsContent>

        {/* Outside the panels: an error raised while switching tabs has to stay
            visible on whichever tab you land on. */}
        {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}
      </Tabs>
    </Dialog>
  );
}
