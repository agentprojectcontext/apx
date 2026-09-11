// Models, for ONE project.
//
// Two lists, deliberately not the Settings screen. There, Engines is a wall of
// provider cards because it is where providers are born; here the interesting
// question is much smaller — "does this project answer with something other
// than the default, and does it reach anything the rest of the machine does
// not?" So: the chain on top, the project's own providers under it, both as
// rows. Everything global stays invisible except as the inherited default,
// because a project screen that reprints the global config is just noise you
// have to read past to find the one line you came to change.
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp, Check, Cpu, GitBranch, Plus, Trash2, X } from "lucide-react";
import { Badge, Button, Field, Input, Switch } from "../ui";
import { UiSelect } from "../UiSelect";
import { useToast } from "../Toast";
import { useOllamaModels } from "../../hooks/useOllamaModels";
import { useSuperAgentConfig } from "../../hooks/useGlobalConfig";
import {
  ProviderModelPicker,
  ollamaTargetsOf,
  providersFromEngines,
  problemHint,
  rowProblem,
  splitRef,
  type EngineEntry,
  type ProviderInfo,
} from "../settings/providerPicker";
import { ENGINE_OPTIONS, ENGINE_ICONS, engineStyle, type EngineType } from "../settings/providers/typeStyles";
import { isSecretMarker, secretHint, secretSuffix } from "../../lib/secrets";
import { toneText } from "../../lib/tone";
import { t } from "../../i18n";

type Cfg = Record<string, unknown>;

function chainOf(cfg: Cfg | undefined): string[] {
  const sa = (cfg?.super_agent || {}) as { model?: string; model_fallback?: { models?: string[] } };
  const rest = Array.isArray(sa.model_fallback?.models) ? sa.model_fallback!.models! : [];
  return sa.model ? [sa.model, ...rest] : rest;
}

function enginesOf(cfg: Cfg | undefined): Record<string, EngineEntry> {
  return ((cfg?.engines || {}) as Record<string, EngineEntry>);
}

export function ProjectModelsTab({
  projectOnly,
  effective,
  onSaveFields,
}: {
  /** This project's own config file — the only thing we ever write. */
  projectOnly: Cfg;
  /** Global merged with it, for "what would happen if you changed nothing". */
  effective: Cfg;
  onSaveFields: (set: Record<string, unknown>, unset: string[]) => Promise<void>;
}) {
  return (
    <div className="space-y-6">
      <ChainCard projectOnly={projectOnly} effective={effective} onSaveFields={onSaveFields} />
      <ExtraEnginesCard projectOnly={projectOnly} effective={effective} onSaveFields={onSaveFields} />
    </div>
  );
}

// --- the chain -------------------------------------------------------------

function ChainCard({
  projectOnly,
  effective,
  onSaveFields,
}: {
  projectOnly: Cfg;
  effective: Cfg;
  onSaveFields: (set: Record<string, unknown>, unset: string[]) => Promise<void>;
}) {
  const toast = useToast();
  const ownChain = useMemo(() => chainOf(projectOnly), [projectOnly]);
  // The fallback has to come from the GLOBAL config, not from `effective`:
  // effective is global-with-this-project-on-top, so the moment the project
  // pins a chain the global one is no longer recoverable from it — and the
  // line would read "it falls back to —" precisely when you clear the chain
  // and most need to know what you are falling back to.
  const { superAgent } = useSuperAgentConfig();
  const globalChain = useMemo(() => (superAgent ? chainOf({ super_agent: superAgent }) : []), [superAgent]);

  const [chain, setChain] = useState<string[]>(ownChain);
  const [saved, setSaved] = useState<string[]>(ownChain);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setChain(ownChain);
    setSaved(ownChain);
    setAdding("");
  }, [ownChain]);

  const engines = useMemo(() => enginesOf(effective), [effective]);
  const { models: ollamaModels, online: ollamaOnline } = useOllamaModels(
    useMemo(() => ollamaTargetsOf(engines), [engines]),
  );
  const providers: ProviderInfo[] = useMemo(
    () => providersFromEngines(engines, ollamaOnline),
    [engines, ollamaOnline],
  );

  const dirty = JSON.stringify(chain) !== JSON.stringify(saved);
  const inherited = chain.length === 0;

  const save = async () => {
    setBusy(true);
    try {
      const [head, ...rest] = chain;
      if (!head) {
        // An empty chain is not "no model" — it is "whatever the machine
        // decides". Unsetting is what makes the project fall back cleanly
        // instead of pinning an empty string nothing can resolve.
        await onSaveFields({}, ["super_agent.model", "super_agent.model_fallback.models", "super_agent.model_fallback.enabled"]);
      } else {
        await onSaveFields(
          {
            "super_agent.model": head,
            "super_agent.model_fallback.enabled": rest.length > 0,
            "super_agent.model_fallback.models": rest,
          },
          [],
        );
      }
      setSaved(chain);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const moveTo = (from: number, to: number) => {
    if (to < 0 || to >= chain.length) return;
    const next = [...chain];
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row);
    setChain(next);
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{t("project_models.chain_title")}</h2>
          <p className="mt-0.5 text-sm text-muted-fg">{t("project_models.chain_desc")}</p>
        </div>
        <Button variant="primary" loading={busy} disabled={!dirty} onClick={save}>
          {dirty ? t("common.save") : t("router_panel.saved")}
        </Button>
      </header>

      <div className="mt-4 space-y-3">
        {inherited && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2.5 text-xs text-muted-fg">
            <span>{t("project_models.inherited")}</span>
            {globalChain.length === 0 && <span className="font-mono">—</span>}
            {globalChain.map((ref, i) => (
              <span key={`${i}-${ref}`} className="flex items-center gap-2">
                {i > 0 && <ArrowRight size={11} />}
                <span className="font-mono">{ref}</span>
              </span>
            ))}
          </div>
        )}

        <ul className="space-y-1">
          {chain.map((ref, i) => {
            const { provider } = splitRef(ref);
            const problem = rowProblem(provider, providers);
            return (
              <li key={`${i}-${ref}`} className="rounded-md border border-border bg-muted/20 px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-6 shrink-0 text-xs text-muted-fg">#{i + 1}</span>
                  {i === 0 ? (
                    <Badge tone="success" className="shrink-0"><GitBranch size={10} /> {t("router_panel.badge_default")}</Badge>
                  ) : (
                    <span className="shrink-0 text-xs text-muted-fg">{t("project_models.fallback")}</span>
                  )}
                  <div className="flex-1">
                    <ProviderModelPicker
                      value={ref}
                      onChange={(v) => setChain(chain.map((x, idx) => (idx === i ? v : x)))}
                      providers={providers}
                      ollamaModels={ollamaModels}
                    />
                  </div>
                  <div className="flex shrink-0 items-center">
                    <Button size="sm" variant="ghost" aria-label={t("project_models.move_up")} disabled={i === 0} onClick={() => moveTo(i, i - 1)}>
                      <ArrowUp size={12} />
                    </Button>
                    <Button size="sm" variant="ghost" aria-label={t("project_models.move_down")} disabled={i === chain.length - 1} onClick={() => moveTo(i, i + 1)}>
                      <ArrowDown size={12} />
                    </Button>
                    <Button size="sm" variant="ghost" aria-label={t("common.delete")} onClick={() => setChain(chain.filter((_, idx) => idx !== i))}>
                      <Trash2 size={12} />
                    </Button>
                  </div>
                </div>
                {problem && <p className={`mt-1 pl-8 text-xs ${toneText.amber}`}>{problemHint(problem, provider)}</p>}
              </li>
            );
          })}
        </ul>

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <ProviderModelPicker value={adding} onChange={setAdding} providers={providers} ollamaModels={ollamaModels} />
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={!adding.includes(":") || adding.endsWith(":") || chain.includes(adding)}
            onClick={() => { setChain([...chain, adding]); setAdding(""); }}
          >
            <Plus size={13} /> {t("project_models.add_step")}
          </Button>
          {chain.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setChain([])}>{t("project_models.use_global")}</Button>
          )}
        </div>
      </div>
    </div>
  );
}

// --- providers this project adds -------------------------------------------

type DraftEngine = { slug: string; engine: EngineType; base_url: string; api_key: string; default_model: string };

const BLANK: DraftEngine = { slug: "", engine: "openai", base_url: "", api_key: "", default_model: "" };

function ExtraEnginesCard({
  projectOnly,
  effective,
  onSaveFields,
}: {
  projectOnly: Cfg;
  effective: Cfg;
  onSaveFields: (set: Record<string, unknown>, unset: string[]) => Promise<void>;
}) {
  const toast = useToast();
  const own = useMemo(() => enginesOf(projectOnly), [projectOnly]);
  const all = useMemo(() => enginesOf(effective), [effective]);
  const inheritedSlugs = useMemo(() => Object.keys(all).filter((s) => !(s in own)).sort(), [all, own]);

  const [draft, setDraft] = useState<DraftEngine | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startNew = () => { setEditing(null); setDraft({ ...BLANK }); };
  const startEdit = (slug: string) => {
    const v = own[slug] || {};
    setEditing(slug);
    setDraft({
      slug,
      engine: ((v.engine as EngineType) || (slug as EngineType) || "openai"),
      base_url: v.base_url || "",
      // Never put a real key in a form field: the daemon sends the marker, and
      // leaving the box empty means "keep whatever is stored".
      api_key: "",
      default_model: v.default_model || "",
    });
  };

  const commit = async () => {
    if (!draft) return;
    const slug = draft.slug.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!slug) { toast.error(t("project_models.slug_required")); return; }
    setBusy(true);
    try {
      const base = `engines.${slug}`;
      const set: Record<string, unknown> = { [`${base}.engine`]: draft.engine, [`${base}.is_active`]: own[slug]?.is_active !== false };
      const unset: string[] = [];
      const opt = (key: string, value: string) => {
        if (value.trim()) set[`${base}.${key}`] = value.trim();
        else unset.push(`${base}.${key}`);
      };
      opt("base_url", draft.base_url);
      opt("default_model", draft.default_model);
      // An empty key field leaves the stored one alone — the alternative is
      // wiping a working credential every time someone edits the base_url.
      if (draft.api_key.trim()) set[`${base}.api_key`] = draft.api_key.trim();
      await onSaveFields(set, unset);
      setDraft(null);
      setEditing(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (slug: string) => {
    try {
      await onSaveFields({}, [`engines.${slug}`]);
    } catch (e) { toast.error((e as Error).message); }
  };

  const toggle = async (slug: string) => {
    try {
      await onSaveFields({ [`engines.${slug}.is_active`]: own[slug]?.is_active === false }, []);
    } catch (e) { toast.error((e as Error).message); }
  };

  const ownSlugs = Object.keys(own).sort();

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{t("project_models.engines_title")}</h2>
          <p className="mt-0.5 text-sm text-muted-fg">{t("project_models.engines_desc")}</p>
        </div>
        <Button size="sm" variant="primary" onClick={startNew}><Plus size={14} /> {t("project_models.add_engine")}</Button>
      </header>

      <div className="mt-4 space-y-3">
        {ownSlugs.length === 0 && !draft && (
          <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-fg">
            {t("project_models.engines_empty")}
          </p>
        )}

        <ul className="space-y-1">
          {ownSlugs.map((slug) => {
            const v = own[slug] || {};
            const Icon = engineStyle(ENGINE_ICONS, (v.engine as EngineType) || (slug as EngineType));
            // A redacted marker is itself a non-empty string, so one check covers both.
            const keyed = typeof v.api_key === "string" && v.api_key.length > 0;
            return (
              <li key={slug} className="flex items-center gap-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm">
                <Icon size={15} className="shrink-0 text-muted-fg" />
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => startEdit(slug)}>
                  <span className="font-medium">{slug}</span>
                  <span className="ml-2 text-xs text-muted-fg">{v.engine || slug}</span>
                  {v.base_url && <span className="ml-2 truncate font-mono text-xs text-muted-fg">{v.base_url}</span>}
                  {/* The marker itself is noise in a row — the last five chars are
                      the whole point of showing it at all. */}
                  {keyed && <span className="ml-2 font-mono text-xs text-muted-fg">…{secretSuffix(v.api_key) || "key"}</span>}
                </button>
                <Switch checked={v.is_active !== false} onChange={() => toggle(slug)} />
                <Button size="sm" variant="ghost" aria-label={t("common.delete")} onClick={() => remove(slug)}>
                  <Trash2 size={12} />
                </Button>
              </li>
            );
          })}
        </ul>

        {draft && (
          <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={t("project_models.slug")} hint={t("project_models.slug_hint")}>
                <Input
                  value={draft.slug}
                  disabled={editing !== null}
                  placeholder="mi-proveedor"
                  onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
                />
              </Field>
              <Field label={t("project_models.engine_kind")}>
                <UiSelect
                  value={draft.engine}
                  onChange={(v) => setDraft({ ...draft, engine: v as EngineType })}
                  options={ENGINE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                />
              </Field>
              <Field label="Base URL">
                <Input value={draft.base_url} placeholder="https://…/v1" onChange={(e) => setDraft({ ...draft, base_url: e.target.value })} />
              </Field>
              <Field label={t("project_models.default_model")}>
                <Input value={draft.default_model} onChange={(e) => setDraft({ ...draft, default_model: e.target.value })} />
              </Field>
              <Field label="API key" hint={editing ? t("project_models.key_keep") : t("project_models.key_local")}>
                <Input
                  type="password"
                  value={draft.api_key}
                  placeholder={editing && isSecretMarker(own[editing]?.api_key) ? secretHint(own[editing]?.api_key) : ""}
                  onChange={(e) => setDraft({ ...draft, api_key: e.target.value })}
                />
              </Field>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="primary" loading={busy} onClick={commit}><Check size={13} /> {t("common.save")}</Button>
              <Button size="sm" variant="ghost" onClick={() => { setDraft(null); setEditing(null); }}><X size={13} /> {t("common.cancel")}</Button>
            </div>
          </div>
        )}

        {inheritedSlugs.length > 0 && (
          <p className="flex flex-wrap items-center gap-1.5 pt-1 text-xs text-muted-fg">
            <Cpu size={12} />
            <span>{t("project_models.also_available")}</span>
            {inheritedSlugs.map((slug) => <span key={slug} className="font-mono">{slug}</span>)}
          </p>
        )}
      </div>
    </div>
  );
}
