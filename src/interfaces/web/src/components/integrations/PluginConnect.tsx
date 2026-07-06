import { useState, type ReactNode } from "react";
import useSWR from "swr";
import { AlertCircle, CheckCircle2, ChevronDown, ExternalLink, Eye, EyeOff, Github, Loader2, WifiOff, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { Integrations, type CatalogEntry, type IntegrationScope, type IntegrationStatus } from "../../lib/api";
import { t } from "../../i18n";
import type { TKey } from "../../i18n";
import { PluginCard } from "./PluginCard";
import { PluginToolsSection } from "./PluginToolsSection";

// One generic component that renders any token-based plugin's config form from
// its `ui` descriptor (structure) + i18n (all display text, keyed by slug). Asana
// and GitHub share it; each keeps its own independent config + credentials.

// Dynamic i18n lookup for computed per-slug keys (t is typed to known keys).
const tk = (key: string, vars?: Record<string, string | number>) => t(key as TKey, vars);

function AsanaLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.833 9.637a4.167 4.167 0 1 1 0 8.333 4.167 4.167 0 0 1 0-8.333zm-13.666 0a4.167 4.167 0 1 1 0 8.333 4.167 4.167 0 0 1 0-8.333zM12 2a4.167 4.167 0 1 1 0 8.333A4.167 4.167 0 0 1 12 2z" />
    </svg>
  );
}

type Accent = { text: string; border: string; hover: string; ring: string; wrap: string };
const ACCENTS: Record<string, Accent> = {
  rose: { text: "text-rose-400", border: "border-rose-700/50", hover: "hover:bg-rose-900/20", ring: "focus:border-rose-500/50", wrap: "border-rose-500/30 from-rose-500/20 to-pink-500/20" },
  slate: { text: "text-slate-200", border: "border-slate-600/60", hover: "hover:bg-slate-700/30", ring: "focus:border-slate-400/60", wrap: "border-slate-500/30 from-slate-500/20 to-slate-700/20" },
};

function iconFor(slug: string, accent: Accent): ReactNode {
  if (slug === "github") return <Github className={cn("h-6 w-6", accent.text)} />;
  if (slug === "asana") return <AsanaLogo className={cn("h-6 w-6", accent.text)} />;
  return <span className={cn("text-lg", accent.text)}>◆</span>;
}

type Step = "idle" | "saving" | "validating" | "done";
type Opt = { value: string; label: string };

export function PluginConnect({ pid, scope, entry }: { pid: string; scope: IntegrationScope; entry: CatalogEntry }) {
  const ui = entry.ui!;
  const accent = ACCENTS[ui.accent || "rose"] || ACCENTS.rose;

  const [expanded, setExpanded] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [showHelp, setShowHelp] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [selectOptions, setSelectOptions] = useState<Opt[]>([]);
  const [selectValue, setSelectValue] = useState("");

  const { data: status, mutate, isLoading } = useSWR<IntegrationStatus>(
    `integration-status-${entry.slug}-${pid}-${scope}`,
    () => Integrations.status(pid, entry.slug, scope),
    { shouldRetryOnError: false },
  );

  const isActive = status?.status === "active" && status.is_enabled === true;
  const busy = step === "saving" || step === "validating";
  const showForm = !isActive && selectOptions.length === 0;

  async function handleConnect() {
    if (ui.configFields.some((f) => !values[f.key]?.trim())) return;
    setStep("saving");
    setError(null);
    try {
      await Integrations.configure(pid, entry.slug, scope, { ...values });
      setStep("validating");
      const result = (await Integrations.validate(pid, entry.slug, scope)) as unknown as Record<string, unknown>;
      await mutate();
      if (ui.select && !result[ui.select.key]) {
        const data = (await Integrations.action(pid, entry.slug, ui.select.action, scope)) as Record<string, unknown>;
        const list = (data[ui.select.listKey] as Record<string, unknown>[]) || [];
        if (list.length > 1) {
          setSelectOptions(list.map((o) => ({ value: String(o[ui.select!.valueKey]), label: String(o[ui.select!.labelKey]) })));
        }
      }
      setStep("done");
      setValues({});
    } catch (err) {
      setError(err instanceof Error ? err.message : t("integrations.err_connect"));
      setStep("idle");
    }
  }

  async function handleSelect() {
    if (!selectValue || !ui.select) return;
    setStep("saving");
    setError(null);
    try {
      await Integrations.configure(pid, entry.slug, scope, { [ui.select.key]: selectValue });
      await Integrations.validate(pid, entry.slug, scope);
      await mutate();
      setSelectOptions([]);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("integrations.err_generic"));
      setStep("idle");
    }
  }

  async function handleDeactivate() {
    setError(null);
    try {
      await Integrations.deactivate(pid, entry.slug, scope);
      await mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("integrations.err_generic"));
    }
  }

  const badgeLabel = isLoading
    ? "…"
    : isActive
      ? t("integrations.status_active")
      : status?.status === "error"
        ? t("integrations.status_error")
        : t("integrations.status_unconfigured");

  return (
    <PluginCard
      icon={
        <div className={cn("flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl border bg-gradient-to-br", accent.wrap)}>
          {iconFor(entry.slug, accent)}
        </div>
      }
      title={entry.name}
      description={entry.description}
      hasTools={(entry.tools?.length ?? 0) > 0}
      badges={
        <span
          className={cn(
            "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px]",
            isActive ? "border-emerald-700 bg-emerald-900/20 text-emerald-400" : "border-border bg-muted text-muted-foreground",
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", isActive ? "bg-emerald-400" : "bg-muted-foreground")} />
          {badgeLabel}
        </span>
      }
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
    >
      <div className="space-y-4 p-4">
        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-red-700/30 bg-red-900/20 px-3 py-2.5 text-xs text-red-300">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)}><X className="h-3.5 w-3.5" /></button>
          </div>
        )}

        {/* Connected summary */}
        {isActive && selectOptions.length === 0 && (
          <div className="space-y-1 rounded-xl border border-emerald-700/30 bg-emerald-900/10 p-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-xs font-medium text-emerald-300">{t("integrations.connected")}</span>
            </div>
            {(ui.connectedFields || []).map((key) => {
              const v = status?.[key];
              if (!v) return null;
              return (
                <p key={key} className="pl-5 text-[10px] text-muted-foreground">
                  {tk(`integrations.${entry.slug}.connected.${key}`)}: {String(v)}
                </p>
              );
            })}
          </div>
        )}

        {/* Post-validate selection (e.g. Asana workspace) */}
        {selectOptions.length > 1 && ui.select && (
          <div className="space-y-2">
            <p className="text-[11px] text-muted-foreground">{tk(`integrations.${entry.slug}.select_label`)}:</p>
            <div className="flex gap-2">
              <select
                value={selectValue}
                onChange={(e) => setSelectValue(e.target.value)}
                className={cn("flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-xs outline-none", accent.ring)}
              >
                <option value="">{t("integrations.select_placeholder")}</option>
                {selectOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <button
                onClick={handleSelect}
                disabled={!selectValue || busy}
                className={cn("rounded-lg border px-3 py-1.5 text-xs transition-all disabled:cursor-not-allowed disabled:opacity-50", accent.border, accent.text, accent.hover)}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("integrations.confirm")}
              </button>
            </div>
          </div>
        )}

        {/* Config form */}
        {showForm && (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-foreground">{t("integrations.credentials", { name: entry.name })}</p>
            {ui.configFields.map((field) => (
              <div key={field.key} className="space-y-2">
                {field.help_url && (
                  <div className="overflow-hidden rounded-lg border border-border">
                    <button
                      type="button"
                      onClick={() => setShowHelp((v) => (v === field.key ? null : field.key))}
                      className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-muted/40"
                    >
                      <span className="text-[11px] text-muted-foreground">
                        {tk(`integrations.${entry.slug}.fields.${field.key}.help_label`)} ·{" "}
                        <a
                          href={field.help_url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className={cn("inline-flex items-center gap-0.5 hover:underline", accent.text)}
                        >
                          {field.help_url_label} <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      </span>
                      <ChevronDown className={cn("h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform", showHelp === field.key && "rotate-180")} />
                    </button>
                    {showHelp === field.key && (
                      <div className="space-y-1.5 border-t border-border px-3 pb-3 pt-2.5">
                        {tk(`integrations.${entry.slug}.fields.${field.key}.help_steps`).split("\n").map((s, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <span className={cn("mt-0.5 flex-shrink-0 font-mono text-[10px]", accent.text)}>{i + 1}.</span>
                            <p className="text-[11px] text-muted-foreground">{s}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-[10px] text-muted-foreground">{tk(`integrations.${entry.slug}.fields.${field.key}.label`)}</label>
                  <div className="relative">
                    <input
                      type={field.type === "password" && !reveal[field.key] ? "password" : "text"}
                      placeholder={field.placeholder}
                      value={values[field.key] || ""}
                      onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && handleConnect()}
                      className={cn("w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs outline-none placeholder:text-muted-foreground/60", field.type === "password" && "pr-14", accent.ring)}
                    />
                    {field.type === "password" && (
                      <button
                        type="button"
                        onClick={() => setReveal((r) => ({ ...r, [field.key]: !r[field.key] }))}
                        className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {reveal[field.key] ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                        {reveal[field.key] ? t("integrations.hide") : t("integrations.reveal")}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {step === "validating" && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("integrations.verifying")}
              </div>
            )}

            <button
              onClick={handleConnect}
              disabled={ui.configFields.some((f) => !values[f.key]?.trim()) || busy}
              className={cn("flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-all disabled:cursor-not-allowed disabled:opacity-50", accent.border, accent.text, accent.hover)}
            >
              {busy ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" />{step === "saving" ? t("integrations.saving") : t("integrations.validating")}</>
              ) : t("integrations.connect")}
            </button>
          </div>
        )}

        {entry.tools && entry.tools.length > 0 && (
          <PluginToolsSection pid={pid} tools={entry.tools} isActive={isActive} />
        )}

        {isActive && (
          <div className="flex justify-end border-t border-border pt-2">
            <button
              onClick={handleDeactivate}
              className="flex items-center gap-1.5 rounded-lg border border-red-700/50 px-3 py-1.5 text-xs text-red-400 transition-all hover:bg-red-900/20"
            >
              <WifiOff className="h-3.5 w-3.5" /> {t("integrations.deactivate")}
            </button>
          </div>
        )}
      </div>
    </PluginCard>
  );
}
