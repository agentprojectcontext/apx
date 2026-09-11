import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, GitBranch, GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { Section } from "../Section";
import { Badge, Button, Loading } from "../ui";
import { Tip } from "../ui/tip";
import { useToast } from "../Toast";
import { useGlobalConfig, useSuperAgentConfig } from "../../hooks/useGlobalConfig";
import { useOllamaModels } from "../../hooks/useOllamaModels";
import {
  ProviderModelPicker,
  providersFromEngines,
  ollamaTargetsOf,
  problemHint,
  rowProblem,
  splitRef,
  type EngineEntry,
  type ProviderInfo,
} from "./providerPicker";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import { toneText } from "../../lib/tone";

/** Payload type for a chain-row drag. Its own type (not text/plain) so text
 *  dropped in from elsewhere is not mistaken for a reorder. */
const DRAG_TYPE = "application/x-apx-chain-row";

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
    () => (config.engines || {}) as Record<string, EngineEntry>,
    [config.engines],
  );

  const { models: ollamaModels, online: ollamaOnline } = useOllamaModels(useMemo(() => ollamaTargetsOf(engines), [engines]));
  const providers: ProviderInfo[] = useMemo(
    () => providersFromEngines(engines, ollamaOnline),
    [engines, ollamaOnline],
  );

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
