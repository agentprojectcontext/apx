import { useState } from "react";
import useSWR from "swr";
import { useNavigate } from "react-router-dom";
import { Sparkles, RefreshCw, Wand2, ArrowUpRight, ChevronDown, ChevronUp } from "lucide-react";
import { Section } from "../Section";
import { Button, Field, Input, Loading, Badge, Switch } from "../ui";
import { cn } from "../../lib/cn";
import { useToast } from "../Toast";
import { Skills, type InspectTrace } from "../../lib/api/skills";
import { Embeddings } from "../../lib/api/embeddings";
import { t } from "../../i18n";

// Skill Inspector — per-turn skill RAG middleware. When ON, the static
// "available skills" slug-dump is removed from the agent's system prompt and a
// local RAG injects, per turn, only the skill(s) the user's message actually
// needs. This panel toggles the feature, tunes its thresholds, (re)builds the
// vector index, and offers a live dry-run so you can see what it would surface.
//
// Mirrors MemoryPanel (RAG embeddings): same Section/Field/Button idiom. Config
// persists under config.skills.inspector.* via the inspector PUT endpoint, so
// no separate global-config patch is needed.

// Numeric knobs with human labels + sane ranges. We keep them as plain number
// inputs (same idiom as the embeddings model fields) rather than sliders so the
// values are explicit and copy-pasteable.
function knobs(): { key: keyof NumericKnobs; label: string; hint: string; step: number; min: number; max: number }[] {
  return [
    { key: "load_threshold", label: t("settings_ui.knob_load_threshold"), hint: t("settings_ui.knob_load_threshold_hint"), step: 0.01, min: 0, max: 1 },
    { key: "hint_threshold", label: t("settings_ui.knob_hint_threshold"), hint: t("settings_ui.knob_hint_threshold_hint"), step: 0.01, min: 0, max: 1 },
    { key: "margin", label: t("settings_ui.knob_margin"), hint: t("settings_ui.knob_margin_hint"), step: 0.01, min: 0, max: 1 },
    { key: "max_loaded", label: t("settings_ui.knob_max_loaded"), hint: t("settings_ui.knob_max_loaded_hint"), step: 1, min: 0, max: 5 },
    { key: "max_hints", label: t("settings_ui.knob_max_hints"), hint: t("settings_ui.knob_max_hints_hint"), step: 1, min: 0, max: 8 },
    { key: "prompt_floor", label: t("settings_ui.knob_prompt_floor"), hint: t("settings_ui.knob_prompt_floor_hint"), step: 1, min: 0, max: 40 },
    { key: "body_char_cap", label: t("settings_ui.knob_body_char_cap"), hint: t("settings_ui.knob_body_char_cap_hint"), step: 500, min: 500, max: 20000 },
  ];
}

type NumericKnobs = {
  load_threshold: number; hint_threshold: number; margin: number;
  max_loaded: number; max_hints: number; prompt_floor: number; body_char_cap: number;
};

export function SkillsInspectorPanel() {
  const toast = useToast();
  const navigate = useNavigate();
  const { data, mutate, isLoading } = useSWR("/api/skills/inspector", () => Skills.inspector());
  const { data: providers } = useSWR("/api/embeddings/providers", () => Embeddings.providers());
  const [busy, setBusy] = useState(false);
  const [probe, setProbe] = useState("");
  const [probeResult, setProbeResult] = useState<InspectTrace | null>(null);
  // Advanced (thresholds) starts collapsed — most turns never touch these.
  const [advOpen, setAdvOpen] = useState(false);

  if (isLoading || !data) return <Loading />;

  const cfg = data.config;
  const idx = data.index;

  const apply = async (patch: Record<string, unknown>) => {
    setBusy(true);
    try {
      await Skills.updateInspector(patch);
      await mutate();
    } catch (e) {
      toast.error(t("settings_ui.could_not_save", { msg: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  const runIndex = async (force = false) => {
    setBusy(true);
    try {
      const r = await Skills.index({ force });
      toast.success(
        t("settings_ui.indexed_with", {
          embedder: r.embedder,
          dim: r.dim,
          added: r.changed.added,
          refreshed: r.changed.refreshed,
          removed: r.changed.removed,
        }),
      );
      await mutate();
    } catch (e) {
      toast.error(t("settings_ui.index_failed", { msg: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  const runProbe = async () => {
    if (!probe.trim()) return;
    setBusy(true);
    setProbeResult(null);
    try {
      const r = await Skills.inspect(probe.trim());
      setProbeResult(r.trace);
    } catch (e) {
      toast.error(t("settings_ui.dry_run_failed", { msg: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1 — Inspector: the ON switch sits top-right opposite the title; below it
          the status and, folded in, the shared-embedder block + reindex. */}
      <Section
        title={t("settings_ui.inspector_title")}
        description={t("settings_ui.inspector_desc")}
        action={
          <Switch
            checked={cfg.enabled}
            disabled={busy}
            onChange={(v) => apply({ enabled: v })}
            label={cfg.enabled ? t("settings_ui.on") : t("settings_ui.off")}
          />
        }
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={idx.count > 0 ? "success" : "warning"}>
              {t("settings_ui.index_count", { n: idx.count })}
            </Badge>
            <Badge tone="muted">{idx.embedder || t("settings_ui.not_indexed")}</Badge>
            {idx.dim ? <Badge tone="muted">{t("settings_ui.dim", { dim: idx.dim })}</Badge> : null}
            {idx.updated_at ? (
              <span className="text-xs text-muted-foreground">
                {t("settings_ui.updated_at", { date: new Date(idx.updated_at).toLocaleString() })}
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={() => runIndex(false)} loading={busy}>
              <RefreshCw size={14} /> {t("settings_ui.reindex")}
            </Button>
            <Button variant="secondary" onClick={() => runIndex(true)} loading={busy}>
              <RefreshCw size={14} /> {t("settings_ui.reindex_forced")}
            </Button>
          </div>

          {/* The embedder is shared with Memory (RAG) — one engine for the whole
              daemon. Surface which one is live now and where to change it, and
              flag when the index was built with a different one (needs reindex). */}
          {(() => {
            // The embedder a real call lands on now (probed server-side) — the
            // honest "active", so a rate-limited gemini that actually falls to
            // ollama shows ollama, not gemini.
            const active = providers?.active_embedder || "";
            const indexTag = idx.embedder || "";
            const stale = !!indexTag && !!active && indexTag !== active;
            return (
              <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/20 p-3 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">
                    {t("settings_ui.embedder_shared_title")}
                  </span>
                  {active ? (
                    <Badge tone={active === "tf" ? "warning" : "success"}>{active}</Badge>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => navigate("/settings/memory")}
                    className="inline-flex items-center gap-1 font-medium text-sky-700 hover:underline dark:text-sky-400"
                  >
                    {t("settings_ui.embedder_configure")} <ArrowUpRight size={12} />
                  </button>
                </div>
                <p className="text-muted-foreground">{t("settings_ui.embedder_shared_desc")}</p>
                {stale ? (
                  <p className="text-amber-600 dark:text-amber-400">
                    {t("settings_ui.embedder_stale", { index: indexTag, active })}
                  </p>
                ) : null}
              </div>
            );
          })()}
        </div>
      </Section>

      {/* 2 — Test (dry-run): dimmed + inert when the inspector is off, like the
          Advanced limits below. */}
      <Section
        title={t("settings_ui.test_title")}
        description={t("settings_ui.test_desc")}
      >
        <div className={cn("space-y-3", !cfg.enabled && "pointer-events-none opacity-50")}>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={probe}
              placeholder={t("settings_ui.test_placeholder")}
              disabled={busy || !cfg.enabled}
              onChange={(ev) => setProbe(ev.target.value)}
              onKeyDown={(ev) => { if (ev.key === "Enter") runProbe(); }}
              className="max-w-xl flex-1"
            />
            <Button variant="primary" onClick={runProbe} loading={busy} disabled={busy || !cfg.enabled}>
              <Wand2 size={14} /> {t("settings_ui.test_btn")}
            </Button>
          </div>

          {probeResult && (
            <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-sm">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Sparkles size={14} className="text-muted-foreground" />
                <span className="text-muted-foreground">{probeResult.embedder || "—"}</span>
                {probeResult.jit ? <Badge tone="warning">{t("settings_ui.jit_empty_index")}</Badge> : null}
                {probeResult.reason && !probeResult.loaded?.length && !probeResult.hinted?.length ? (
                  <Badge tone="muted">{probeResult.reason}</Badge>
                ) : null}
              </div>

              {probeResult.loaded?.length ? (
                <div className="mb-1">
                  <span className="text-muted-foreground">{t("settings_ui.loaded_label")} </span>
                  {probeResult.loaded.map((s) => (
                    <Badge key={s} tone="success" className="mr-1">{s}</Badge>
                  ))}
                </div>
              ) : null}

              {probeResult.hinted?.length ? (
                <div className="mb-1">
                  <span className="text-muted-foreground">{t("settings_ui.suggested_label")} </span>
                  {probeResult.hinted.map((s) => (
                    <Badge key={s} tone="info" className="mr-1">{s}</Badge>
                  ))}
                </div>
              ) : null}

              {probeResult.scored?.length ? (
                <div className="mt-2 space-y-0.5 font-mono text-xs text-muted-foreground">
                  {probeResult.scored.map((s) => (
                    <div key={s.slug}>{s.sim.toFixed(3)}  {s.slug}</div>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </Section>

      {/* 3 — Advanced: the thresholds, collapsed by default so they don't tire the
          eye, and dimmed + inert when the inspector is off. */}
      <Section
        title={t("settings_ui.advanced_title")}
        description={t("settings_ui.thresholds_desc")}
        action={
          <button
            type="button"
            onClick={() => setAdvOpen((o) => !o)}
            aria-expanded={advOpen}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            {advOpen ? t("settings_ui.hide") : t("settings_ui.show")}
            {advOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        }
      >
        {advOpen ? (
          <div
            className={cn(
              "grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4",
              !cfg.enabled && "pointer-events-none opacity-50",
            )}
          >
            {knobs().map((k) => (
              <Field key={k.key} label={k.label} hint={k.hint}>
                <Input
                  type="number"
                  step={k.step}
                  min={k.min}
                  max={k.max}
                  defaultValue={String(cfg[k.key])}
                  disabled={busy || !cfg.enabled}
                  onBlur={(ev) => {
                    const n = Number(ev.target.value);
                    if (Number.isFinite(n) && n !== cfg[k.key]) apply({ [k.key]: n });
                  }}
                  className="max-w-[12rem]"
                />
              </Field>
            ))}
          </div>
        ) : null}
      </Section>
    </div>
  );
}
