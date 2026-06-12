import { useEffect, useMemo, useState } from "react";
import { Braces, Loader2, RefreshCw } from "lucide-react";
import { Button, Dialog, Field, Input, Switch, Textarea } from "../../ui";
import { UiSelect } from "../../UiSelect";
import { ModelCombobox } from "../../ModelCombobox";
import { Engines } from "../../../lib/api";
import { isSecretMarker, secretSuffix } from "../../../lib/secrets";
import { ENGINE_ICONS, ENGINE_OPTIONS, ENGINE_PRESETS, type EngineType } from "./typeStyles";
import type { Provider } from "./types";
import { t } from "../../../i18n";

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
  is_active: true, context_limit_tokens: 200000, model_context_limits_json: "",
  p_input: "", p_output: "", p_cache_read: "", p_cache_write: "",
};

// Preset pills shown on create (the common providers).
const PRESET_PILLS: EngineType[] = ["anthropic", "openai", "gemini", "groq", "openrouter", "ollama", "custom"];

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

  // Apply a full preset (pill click on create): name/slug/engine/base_url/model.
  const pickPreset = (engine: EngineType) => {
    const p = ENGINE_PRESETS[engine];
    up({
      engine,
      name: engine === "custom" ? f.name : (ENGINE_OPTIONS.find((o) => o.value === engine)?.label || engine),
      slug: engine === "custom" ? f.slug : engine,
      base_url: p.base_url,
      default_model: p.default_model,
    });
    setAvailableModels(p.known_models);
    setModelError(null);
  };

  // Engine select change: switch adapter, soft-fill base_url/model if empty.
  const changeEngine = (engine: EngineType) => {
    const p = ENGINE_PRESETS[engine];
    up({
      engine,
      base_url: f.base_url || p.base_url,
      default_model: f.default_model || p.default_model,
    });
    setAvailableModels(p.known_models);
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
      if (r.models.length === 0) setModelError("Sin modelos. ¿Key/URL correctas?");
    } catch (e) {
      setModelError((e as Error).message || "No se pudo listar modelos.");
    } finally { setLoadingModels(false); }
  };

  const modelOptions = useMemo(() => (
    f.default_model && !availableModels.includes(f.default_model)
      ? [f.default_model, ...availableModels]
      : availableModels
  ), [availableModels, f.default_model]);

  const buildProvider = (): { provider: Provider; modelLimits?: Record<string, number> } | null => {
    const slug = (f.slug || slugify(f.name)).trim();
    if (!slug) { setError("Slug requerido."); return null; }
    if (!isEdit && existingSlugs.includes(slug)) { setError(`Ya existe un provider "${slug}".`); return null; }

    let modelLimits: Record<string, number> | undefined;
    if (f.model_context_limits_json.trim()) {
      try {
        const parsed = JSON.parse(f.model_context_limits_json);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
        modelLimits = parsed;
      } catch { setError("Límites de contexto por modelo: JSON inválido."); return null; }
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

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (jsonMode) {
        const slug = (f.slug || slugify(f.name)).trim();
        if (!slug) { setError("Slug requerido (en el formulario)."); return; }
        let parsed: unknown;
        try { parsed = JSON.parse(jsonText); }
        catch { setError("JSON inválido: revisá la sintaxis."); return; }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          setError("El JSON debe ser un objeto con la config del provider."); return;
        }
        const raw = parsed as Record<string, unknown>;
        if (!raw.engine || typeof raw.engine !== "string") {
          setError('Falta "engine" (ej. "anthropic", "ollama").'); return;
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
      setError((e as Error).message || "Error al guardar.");
    } finally { setBusy(false); }
  };

  const existingKey = isEdit && isSecretMarker(initial?.api_key);
  const keySuffix = secretSuffix(initial?.api_key);
  const keyPlaceholder = existingKey ? `…${keySuffix ?? ""} (ya seteada)` : "sk-…";
  const isOllama = f.engine === "ollama";
  const apiKeyEnv = ENGINE_PRESETS[f.engine]?.api_key_env;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? t("providers_modal.edit_title", { name: initial?.name || initial?.slug || "" }) : t("providers_modal.new_title")}
      description="Proveedor LLM. El motor (engine) define qué adapter usa (openai, ollama, …)."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant="primary" onClick={submit} loading={busy}>{isEdit ? "Guardar" : "Crear"}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          {!isEdit ? (
            <div className="flex flex-wrap gap-1.5">
              {PRESET_PILLS.map((eng) => {
                const Icon = ENGINE_ICONS[eng];
                const label = eng === "custom" ? "Custom" : (ENGINE_OPTIONS.find((o) => o.value === eng)?.label || eng);
                const selected = f.engine === eng;
                return (
                  <button
                    key={eng}
                    type="button"
                    onClick={() => pickPreset(eng)}
                    className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                      selected
                        ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                        : "border-border text-muted-fg hover:border-muted-fg/60 hover:text-foreground"
                    }`}
                  >
                    <Icon className="size-3.5" /> {label}
                  </button>
                );
              })}
            </div>
          ) : <span />}
          <button
            type="button"
            onClick={() => (jsonMode ? setJsonMode(false) : enterJsonMode())}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors ${
              jsonMode ? "border-sky-500/50 bg-sky-500/10 text-sky-400" : "border-border text-muted-fg hover:text-foreground"
            }`}
          >
            <Braces className="size-3.5" /> {jsonMode ? "Volver al formulario" : "JSON"}
          </button>
        </div>

        {jsonMode ? (
          <div className="space-y-2">
            <Field label="Config del provider (JSON)" hint={`Se guarda como engines.${(f.slug || slugify(f.name)) || "<slug>"} en config.json`}>
              <Textarea
                rows={14}
                className="font-mono text-xs"
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                spellCheck={false}
              />
            </Field>
            <p className="text-[11px] text-muted-fg">Debe ser un objeto JSON válido con al menos <code>engine</code>. El slug se toma del formulario.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nombre">
                <Input value={f.name} onChange={(e) => up({ name: e.target.value, slug: isEdit ? f.slug : slugify(e.target.value) })} placeholder="Mi provider" />
              </Field>
              <Field label="Motor (engine)">
                <UiSelect
                  value={f.engine}
                  onChange={(v) => changeEngine(v as EngineType)}
                  options={ENGINE_OPTIONS.map((o) => ({ value: o.value, label: o.label, icon: ENGINE_ICONS[o.value] }))}
                />
              </Field>
            </div>

            <Field label="URL base (base_url)" hint="Se completa sola al elegir un proveedor.">
              <Input value={f.base_url} onChange={(e) => up({ base_url: e.target.value })} placeholder="https://api.openai.com/v1" />
            </Field>

            {!isOllama && (
              <Field label="API key" hint={existingKey ? "Dejá en blanco para mantener la actual." : apiKeyEnv ? `Se guarda como secreto. Env sugerida: ${apiKeyEnv}` : "Se guarda como secreto."}>
                <Input type="password" autoComplete="new-password" value={f.api_key_value} onChange={(e) => up({ api_key_value: e.target.value })} placeholder={keyPlaceholder} />
              </Field>
            )}

            <Field label="Modelo por defecto">
              <div className="space-y-2">
                <div className="flex items-start gap-2">
                  <ModelCombobox
                    value={f.default_model}
                    onChange={(v) => up({ default_model: v })}
                    options={modelOptions}
                    className="flex-1"
                  />
                  <Button size="sm" variant="secondary" onClick={loadModels} disabled={loadingModels} title={t("providers_modal.list_models_hint")} aria-label={t("providers_modal.list_models_hint")}>
                    {loadingModels ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                    Cargar modelos
                  </Button>
                </div>
                {modelError && <p className="text-[11px] text-amber-400">{modelError}</p>}
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Máx. tokens (max_tokens)"><Input type="number" min={256} step={256} value={f.default_max_tokens} onChange={(e) => up({ default_max_tokens: parseInt(e.target.value) || 4096 })} /></Field>
              <Field label={`Temperatura: ${f.default_temperature.toFixed(1)}`}>
                <input type="range" min={0} max={2} step={0.1} value={f.default_temperature} onChange={(e) => up({ default_temperature: parseFloat(e.target.value) })} className="mt-2 w-full accent-foreground" />
              </Field>
            </div>

            <details className="rounded-md border border-border bg-muted/20 p-3">
              <summary className="cursor-pointer text-xs font-medium text-muted-fg">Análisis de tokens / pricing (opcional)</summary>
              <div className="mt-3 space-y-3">
                <Field label="Límite de contexto (tokens)"><Input type="number" min={0} step={1024} value={f.context_limit_tokens} onChange={(e) => up({ context_limit_tokens: parseInt(e.target.value) || 0 })} /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="$ entrada / 1M"><Input type="number" min={0} step={0.0001} value={f.p_input} onChange={(e) => up({ p_input: e.target.value })} placeholder="0.15" /></Field>
                  <Field label="$ salida / 1M"><Input type="number" min={0} step={0.0001} value={f.p_output} onChange={(e) => up({ p_output: e.target.value })} placeholder="0.60" /></Field>
                  <Field label="$ cache read / 1M"><Input type="number" min={0} step={0.0001} value={f.p_cache_read} onChange={(e) => up({ p_cache_read: e.target.value })} placeholder="0.03" /></Field>
                  <Field label="$ cache write / 1M"><Input type="number" min={0} step={0.0001} value={f.p_cache_write} onChange={(e) => up({ p_cache_write: e.target.value })} placeholder="0.00" /></Field>
                </div>
                <Field label="Límites de contexto por modelo (JSON)" hint='{"gpt-4o-mini":128000}'>
                  <Textarea rows={3} className="font-mono text-xs" value={f.model_context_limits_json} onChange={(e) => up({ model_context_limits_json: e.target.value })} />
                </Field>
              </div>
            </details>

            <Switch checked={f.is_active} onChange={(v) => up({ is_active: v })} label="Activo (los agentes pueden usarlo)" />
          </>
        )}

        {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}
      </div>
    </Dialog>
  );
}
