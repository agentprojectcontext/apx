import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, GitBranch, GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { Section } from "../Section";
import { Badge, Button, Loading } from "../ui";
import { Tip } from "../ui/tip";
import { Combobox, type ComboOption } from "../Combobox";
import { ModelCombobox } from "../ModelCombobox";
import { useToast } from "../Toast";
import { useGlobalConfig, useSuperAgentConfig } from "../../hooks/useGlobalConfig";
import { useOllamaModels } from "../../hooks/useOllamaModels";
import { ENGINE_ICONS, ENGINE_PRESETS, engineStyle, type EngineType } from "./providers/typeStyles";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import { toneText } from "../../lib/tone";

interface ProviderInfo {
  slug: string;
  engine: EngineType;
  label: string;
  base_url?: string;
  default_model?: string;
  /** is_active in config.engines — the switch on the provider card below. */
  active: boolean;
  /** Has what it needs to answer: an api key, or a reachable Ollama server. */
  connected: boolean;
}

/** Payload type for a chain-row drag. Its own type (not text/plain) so text
 *  dropped in from elsewhere is not mistaken for a reorder. */
const DRAG_TYPE = "application/x-apx-chain-row";

/** Why a row cannot be used, or null when it is fine. */
type RowProblem = "missing" | "off" | "offline" | null;

function splitRef(ref: string): { provider: string; model: string } {
  const i = ref.indexOf(":");
  if (i < 0) return { provider: ref, model: "" };
  return { provider: ref.slice(0, i), model: ref.slice(i + 1) };
}

function problemHint(problem: RowProblem, name: string): string {
  if (problem === "missing") return t("router_panel.provider_not_configured", { name });
  if (problem === "off") return t("router_panel.provider_off", { name });
  if (problem === "offline") return t("router_panel.provider_offline", { name });
  return "";
}

// Provider combobox + model combobox. Serializes to "provider:model".
// Both sides accept free text: providers are a fixed list you normally pick
// from, but a slug that is not configured (yet) must stay typeable.
function ProviderModelPicker({
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
      // Only connected + active providers are pickable. The rest stay visible
      // so it is obvious why they are not an option.
      disabled: !p.active || !p.connected,
      hint: !p.active ? t("router_panel.hint_off") : !p.connected ? t("router_panel.hint_offline") : undefined,
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

function rowProblem(providerSlug: string, providers: ProviderInfo[]): RowProblem {
  if (!providerSlug) return null;
  const p = providers.find((x) => x.slug === providerSlug);
  if (!p) return "missing";
  if (!p.active) return "off";
  if (!p.connected) return "offline";
  return null;
}

// General model router (no per-task cases): one ordered chain where #1 is the
// default model and the rest are tried in order when it fails. Backed by
// super_agent.model (= #1) + super_agent.model_fallback.models (= the rest).
export function DefaultRouterCard() {
  const toast = useToast();
  const { superAgent, isLoading, mutate } = useSuperAgentConfig();
  const { config, patch } = useGlobalConfig();

  const [chain, setChain] = useState<string[]>([]);
  const [newEntry, setNewEntry] = useState("");
  const [editIdx, setEditIdx] = useState<number | null>(null);
  // Reordering: `armed` gates draggable so only the handle starts a drag —
  // otherwise a row in edit mode would drag when you select text in its inputs.
  const [dragArmed, setDragArmed] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  // Snapshot of the saved state, for dirty tracking.
  const [saved, setSaved] = useState<string[]>([]);

  useEffect(() => {
    if (!superAgent) return;
    const f = superAgent.model_fallback?.models;
    const rest = Array.isArray(f) ? f : [];
    const next = superAgent.model ? [superAgent.model, ...rest] : rest;
    setChain(next);
    setSaved(next);
  }, [superAgent]);

  const engines = useMemo(
    () => (config.engines || {}) as Record<string, { engine?: string; name?: string; default_model?: string; base_url?: string; api_key?: string; is_active?: boolean }>,
    [config.engines],
  );

  const ollamaTargets = useMemo(
    () => Object.entries(engines)
      .filter(([slug, v]) => ((v?.engine as EngineType) || (slug as EngineType)) === "ollama")
      .map(([slug, v]) => ({ slug, base_url: v?.base_url })),
    [engines],
  );
  const { models: ollamaModels, online: ollamaOnline } = useOllamaModels(ollamaTargets);

  const providers: ProviderInfo[] = useMemo(() => {
    return Object.entries(engines).map(([slug, v]) => {
      const engine = ((v?.engine as EngineType) || (slug as EngineType));
      const name = v?.name || slug;
      const hasKey = typeof v?.api_key === "string" && v.api_key.length > 0;
      // Ollama/mock/custom need no key; for Ollama we know whether the server
      // actually answered. `undefined` = still probing → assume reachable so
      // the list does not flicker to "offline" on first paint.
      const connected =
        engine === "ollama" ? ollamaOnline[slug] !== false
        : engine === "mock" ? true
        : engine === "custom" ? hasKey || !!v?.base_url
        : hasKey;
      return {
        slug,
        engine,
        label: name === engine ? name : `${name} (${engine})`,
        base_url: v?.base_url,
        default_model: v?.default_model,
        active: v?.is_active !== false,
        connected,
      };
    });
  }, [engines, ollamaOnline]);

  if (isLoading || !superAgent) return <Loading />;

  const dirty = JSON.stringify(chain) !== JSON.stringify(saved);

  const submit = async () => {
    setBusy(true);
    try {
      const [head, ...rest] = chain;
      await patch({
        "super_agent.model": head || "",
        "super_agent.model_fallback.enabled": rest.length > 0,
        "super_agent.model_fallback.models": rest,
      });
      toast.success(t("router_panel.saved_toast"));
      setSaved(chain);
      mutate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  };

  const addEntry = () => {
    const v = newEntry.trim().replace(/:$/, "");
    if (!v || !v.includes(":") || chain.includes(v)) return;
    setChain([...chain, v]);
    setNewEntry("");
  };
  const updateAt = (i: number, v: string) => {
    const next = [...chain];
    next[i] = v;
    setChain(next);
  };
  const removeAt = (i: number) => {
    setChain(chain.filter((_, idx) => idx !== i));
    if (editIdx === i) setEditIdx(null);
  };
  const moveTo = (from: number, to: number) => {
    if (from === to || to < 0 || to >= chain.length) return;
    const next = [...chain];
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row);
    setChain(next);
    // Keep an open editor pointed at the entry it was opened on.
    if (editIdx === from) setEditIdx(to);
    else if (editIdx !== null) setEditIdx(null);
  };
  const endDrag = () => { setDragFrom(null); setDragOver(null); setDragArmed(false); };

  return (
    <Section
      title={t("router_panel.title")}
      description={t("router_panel.description")}
      action={
        <Button variant="primary" loading={busy} disabled={!dirty} onClick={submit}>
          {dirty ? t("router_panel.save") : t("router_panel.saved")}
        </Button>
      }
    >
      <div className="space-y-4">
        {providers.length === 0 && <p className="text-xs text-muted-fg">{t("router_panel.no_providers")}</p>}

        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <div className="mb-2">
            <div className="text-sm font-medium">{t("router_panel.chain_title")}</div>
            <div className="text-xs text-muted-fg">{t("router_panel.chain_desc")}</div>
          </div>
          <ul className="mb-3 space-y-1">
            {chain.map((ref, i) => {
              const { provider } = splitRef(ref);
              const problem = rowProblem(provider, providers);
              const editing = editIdx === i;
              return (
                <li
                  key={`${i}-${ref}`}
                  draggable={dragArmed}
                  onDragStart={(e) => { setDragFrom(i); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData(DRAG_TYPE, String(i)); }}
                  onDragOver={(e) => {
                    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setDragOver(i);
                  }}
                  onDragLeave={() => setDragOver((d) => (d === i ? null : d))}
                  onDrop={(e) => {
                    e.preventDefault();
                    // The source index rides on the drag itself, so the drop
                    // does not depend on React having committed dragFrom.
                    const raw = e.dataTransfer.getData(DRAG_TYPE);
                    const parsed = raw === "" ? NaN : Number(raw);
                    const from = Number.isInteger(parsed) ? parsed : dragFrom;
                    if (from !== null) moveTo(from, i);
                    endDrag();
                  }}
                  onDragEnd={endDrag}
                  className={cn(
                    "rounded-md bg-card px-2 py-1.5 text-xs",
                    // Armed = the pointer went down on a handle. Killing text
                    // selection here keeps a drag from painting a blue streak
                    // across every row it passes.
                    dragArmed && "select-none",
                    dragFrom === i && "opacity-50",
                    dragOver === i && dragFrom !== i && "ring-1 ring-ring",
                  )}
                >
                  <div className="flex items-center gap-2">
                    {/* Grab here to reorder; arrow keys do the same from the keyboard. */}
                    <button
                      type="button"
                      aria-label={t("router_panel.reorder")}
                      title={t("router_panel.reorder")}
                      onMouseDown={() => setDragArmed(true)}
                      onMouseUp={() => setDragArmed(false)}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowUp") { e.preventDefault(); moveTo(i, i - 1); }
                        if (e.key === "ArrowDown") { e.preventDefault(); moveTo(i, i + 1); }
                      }}
                      className="shrink-0 cursor-grab text-muted-fg hover:text-foreground active:cursor-grabbing"
                    >
                      <GripVertical size={13} />
                    </button>
                    <span className="w-6 shrink-0 text-muted-fg">#{i + 1}</span>
                    {i === 0 && (
                      <Badge tone="success" className="shrink-0"><GitBranch size={10} /> {t("router_panel.badge_default")}</Badge>
                    )}
                    {editing ? (
                      <div className="flex-1">
                        <ProviderModelPicker value={ref} onChange={(v) => updateAt(i, v)} providers={providers} ollamaModels={ollamaModels} />
                      </div>
                    ) : (
                      <button type="button" onClick={() => setEditIdx(i)} className="flex flex-1 items-center gap-1.5 text-left">
                        <span className={`font-mono ${problem ? toneText.amber : ""}`}>{ref}</span>
                        {problem && (
                          <Tip content={problemHint(problem, provider)}>
                            <span><AlertTriangle size={12} className={toneText.amber} /></span>
                          </Tip>
                        )}
                      </button>
                    )}
                    {editing ? (
                      <Button size="sm" variant="secondary" onClick={() => setEditIdx(null)}>{t("router_panel.done")}</Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setEditIdx(i)}><Pencil size={12} /></Button>
                    )}
                    <Button size="sm" variant="destructive" onClick={() => removeAt(i)}><Trash2 size={12} /></Button>
                  </div>
                </li>
              );
            })}
            {chain.length === 0 && <li className="text-xs text-muted-fg">{t("router_panel.chain_empty")}</li>}
          </ul>
          {providers.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs text-muted-fg">{t("router_panel.add_to_chain")}</div>
              <ProviderModelPicker value={newEntry} onChange={setNewEntry} providers={providers} ollamaModels={ollamaModels} />
              <Button size="sm" variant="secondary" onClick={addEntry} disabled={!newEntry.includes(":") || newEntry.endsWith(":")}>
                <Plus size={13} /> {t("router_panel.add_to_chain")}
              </Button>
            </div>
          )}
        </div>

        {/* Resolution preview: what the router will actually walk, in order. */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 p-3">
          <Badge tone="success"><GitBranch size={11} /> {t("router_panel.badge_default")}</Badge>
          {chain.length === 0 && <span className="font-mono text-xs text-muted-fg">—</span>}
          {chain.map((ref, i) => {
            const problem = rowProblem(splitRef(ref).provider, providers);
            return (
              <span key={`${i}-${ref}`} className="flex items-center gap-2 text-muted-fg">
                {i > 0 && <ArrowRight size={12} />}
                <span className={`font-mono text-xs ${problem ? toneText.amber : ""}`}>{ref}</span>
              </span>
            );
          })}
        </div>
      </div>
    </Section>
  );
}
