import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, GitBranch, Pencil, Plus, Trash2 } from "lucide-react";
import { Section } from "../Section";
import { Badge, Button, Field, Loading } from "../ui";
import { UiSelect } from "../UiSelect";
import { ModelCombobox } from "../ModelCombobox";
import { useToast } from "../Toast";
import { useGlobalConfig, useSuperAgentConfig } from "../../hooks/useGlobalConfig";
import { ENGINE_ICONS, ENGINE_PRESETS, type EngineType } from "./providers/typeStyles";
import { t } from "../../i18n";

interface ProviderInfo {
  slug: string;
  engine: EngineType;
  default_model?: string;
}

function splitRef(ref: string): { provider: string; model: string } {
  const i = ref.indexOf(":");
  if (i < 0) return { provider: ref, model: "" };
  return { provider: ref.slice(0, i), model: ref.slice(i + 1) };
}

// Provider dropdown + editable model combobox. Serializes to "provider:model".
function ProviderModelPicker({
  value,
  onChange,
  providers,
}: {
  value: string;
  onChange: (ref: string) => void;
  providers: ProviderInfo[];
}) {
  const { provider, model } = splitRef(value);
  const current = providers.find((p) => p.slug === provider);
  const providerInvalid = !!provider && !current;

  const modelOptions = useMemo(() => {
    const known = current ? ENGINE_PRESETS[current.engine]?.known_models || [] : [];
    return Array.from(new Set([
      ...(current?.default_model ? [current.default_model] : []),
      ...known,
    ]));
  }, [current]);

  const setProvider = (slug: string) => {
    const p = providers.find((x) => x.slug === slug);
    const m = p?.default_model || ENGINE_PRESETS[p?.engine as EngineType]?.default_model || "";
    onChange(m ? `${slug}:${m}` : `${slug}:`);
  };
  const setModel = (m: string) => onChange(`${provider}:${m}`);

  return (
    <div className="grid grid-cols-2 gap-2">
      <UiSelect
        value={provider}
        onChange={setProvider}
        placeholder={providerInvalid ? `⚠ ${provider} (no existe)` : "— proveedor —"}
        options={providers.map((p) => ({ value: p.slug, label: p.slug, icon: ENGINE_ICONS[p.engine] }))}
      />
      <ModelCombobox
        value={model}
        onChange={setModel}
        options={modelOptions}
        invalid={providerInvalid}
        invalidHint={`El proveedor "${provider}" no está configurado.`}
      />
    </div>
  );
}

// General model router (no per-task cases): primary model + ordered fallback
// chain. Backed by super_agent.model + super_agent.model_fallback.models.
export function DefaultRouterCard() {
  const toast = useToast();
  const { superAgent, isLoading, mutate } = useSuperAgentConfig();
  const { config, patch } = useGlobalConfig();

  const [model, setModel] = useState("");
  const [fallback, setFallback] = useState<string[]>([]);
  const [newFallback, setNewFallback] = useState("");
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  // Snapshot of the saved state, for dirty tracking.
  const [saved, setSaved] = useState<{ model: string; fallback: string[] }>({ model: "", fallback: [] });

  useEffect(() => {
    if (!superAgent) return;
    const f = superAgent.model_fallback?.models || [];
    const arr = Array.isArray(f) ? f : [];
    setModel(superAgent.model || "");
    setFallback(arr);
    setSaved({ model: superAgent.model || "", fallback: arr });
  }, [superAgent]);

  const providers: ProviderInfo[] = useMemo(() => {
    const engines = (config.engines || {}) as Record<string, { engine?: string; default_model?: string }>;
    return Object.entries(engines).map(([slug, v]) => ({
      slug,
      engine: ((v?.engine as EngineType) || (slug as EngineType)),
      default_model: v?.default_model || ENGINE_PRESETS[(v?.engine as EngineType) || (slug as EngineType)]?.default_model,
    }));
  }, [config.engines]);

  const providerExists = (ref: string) => {
    const { provider } = splitRef(ref);
    return providers.some((p) => p.slug === provider);
  };

  if (isLoading || !superAgent) return <Loading />;

  const dirty = model !== saved.model || JSON.stringify(fallback) !== JSON.stringify(saved.fallback);

  const submit = async () => {
    setBusy(true);
    try {
      await patch({
        "super_agent.model": model,
        "super_agent.model_fallback.enabled": fallback.length > 0,
        "super_agent.model_fallback.models": fallback,
      });
      toast.success("Router guardado.");
      setSaved({ model, fallback });
      mutate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  };

  const addFallback = () => {
    const v = newFallback.trim().replace(/:$/, "");
    if (!v || !v.includes(":") || fallback.includes(v)) return;
    setFallback([...fallback, v]);
    setNewFallback("");
  };
  const updateAt = (i: number, v: string) => {
    const next = [...fallback];
    next[i] = v;
    setFallback(next);
  };
  const removeFallback = (i: number) => {
    setFallback(fallback.filter((_, idx) => idx !== i));
    if (editIdx === i) setEditIdx(null);
  };
  const moveFallback = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= fallback.length) return;
    const next = [...fallback];
    [next[i], next[j]] = [next[j], next[i]];
    setFallback(next);
  };

  return (
    <Section
      title={t("router_panel.title")}
      description="Un solo router general (sin casos por tarea). Elegí proveedor y modelo; si el activo falla, prueba la cadena de fallback en orden."
    >
      <div className="space-y-4">
        {/* Resolution preview */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 p-3">
          <Badge tone="success"><GitBranch size={11} /> default</Badge>
          <span className={`font-mono text-xs ${!providerExists(model) && model ? "text-amber-400" : ""}`}>{model || "—"}</span>
          {fallback.map((m) => (
            <span key={m} className="flex items-center gap-2 text-muted-fg">
              <ArrowRight size={12} />
              <span className={`font-mono text-xs ${!providerExists(m) ? "text-amber-400" : ""}`}>{m}</span>
            </span>
          ))}
        </div>

        {providers.length === 0 ? (
          <p className="text-xs text-muted-fg">Agregá un proveedor abajo para poder elegir modelos.</p>
        ) : (
          <Field label="Modelo activo (default)" hint="Proveedor + modelo. Se guarda como provider:model.">
            <ProviderModelPicker value={model} onChange={setModel} providers={providers} />
          </Field>
        )}

        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <div className="mb-2">
            <div className="text-sm font-medium">Cadena de fallback</div>
            <div className="text-xs text-muted-fg">Si el modelo activo falla, prueba estos en orden. Click en uno para editarlo.</div>
          </div>
          <ul className="mb-3 space-y-1">
            {fallback.map((m, i) => {
              const invalid = !providerExists(m);
              const editing = editIdx === i;
              return (
                <li key={`${i}-${m}`} className="rounded-md bg-card px-2 py-1.5 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-6 text-muted-fg">#{i + 1}</span>
                    {editing ? (
                      <div className="flex-1">
                        <ProviderModelPicker value={m} onChange={(v) => updateAt(i, v)} providers={providers} />
                      </div>
                    ) : (
                      <button type="button" onClick={() => setEditIdx(i)} className="flex flex-1 items-center gap-1.5 text-left">
                        {invalid && <AlertTriangle size={12} className="text-amber-400" />}
                        <span className={`font-mono ${invalid ? "text-amber-400" : ""}`}>{m}</span>
                      </button>
                    )}
                    {editing ? (
                      <Button size="sm" variant="secondary" onClick={() => setEditIdx(null)}>listo</Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setEditIdx(i)}><Pencil size={12} /></Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => moveFallback(i, -1)} disabled={i === 0}>↑</Button>
                    <Button size="sm" variant="ghost" onClick={() => moveFallback(i, +1)} disabled={i === fallback.length - 1}>↓</Button>
                    <Button size="sm" variant="destructive" onClick={() => removeFallback(i)}><Trash2 size={12} /></Button>
                  </div>
                </li>
              );
            })}
            {fallback.length === 0 && <li className="text-xs text-muted-fg">Sin fallback configurado.</li>}
          </ul>
          {providers.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs text-muted-fg">Agregar a la cadena</div>
              <ProviderModelPicker value={newFallback} onChange={setNewFallback} providers={providers} />
              <Button size="sm" variant="secondary" onClick={addFallback} disabled={!newFallback.includes(":") || newFallback.endsWith(":")}>
                <Plus size={13} /> Agregar a la cadena
              </Button>
            </div>
          )}
        </div>

        <Button variant="primary" loading={busy} disabled={!dirty} onClick={submit}>
          {dirty ? "Guardar router" : "Guardado"}
        </Button>
      </div>
    </Section>
  );
}
