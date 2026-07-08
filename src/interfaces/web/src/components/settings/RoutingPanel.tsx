import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Route as RouteIcon, Image, Ruler, Radio, Hash, ChevronRight } from "lucide-react";
import { Section } from "../Section";
import { Badge, Button, Dialog, Field, Loading, Switch, Textarea, Tip } from "../ui";
import { useToast } from "../Toast";
import { useGlobalConfig } from "../../hooks/useGlobalConfig";
import { t } from "../../i18n";

// Content-based model routing (OpenHands RouterLLM pattern). NOT the failover
// router (that is DefaultRouterCard). Here each rule prefers a model for a turn
// based on features (image/size/channel/keywords); it composes with failover —
// a routed model that is down still falls back down the regular chain.
interface RoutingWhen {
  has_image?: boolean;
  min_prompt_chars?: number;
  max_prompt_chars?: number;
  min_context_chars?: number;
  channels?: string[];
  keywords?: string[];
}
interface RoutingRule {
  model: string;
  when?: RoutingWhen;
}

const EXAMPLE_RULES: RoutingRule[] = [
  { model: "openai:gpt-4o", when: { has_image: true } },
  { model: "anthropic:claude-3-5-haiku", when: { max_prompt_chars: 400 } },
];

// Render a rule's `when` block as readable condition chips.
function WhenChips({ when }: { when?: RoutingWhen }) {
  const chips: { icon: ReactNode; label: string }[] = [];
  if (!when || Object.keys(when).length === 0) {
    chips.push({ icon: <ChevronRight size={11} />, label: t("routing_panel.when_any") });
  } else {
    if (when.has_image === true) chips.push({ icon: <Image size={11} />, label: t("routing_panel.when_image") });
    if (when.has_image === false) chips.push({ icon: <Image size={11} />, label: t("routing_panel.when_no_image") });
    if (Number.isFinite(when.min_prompt_chars))
      chips.push({ icon: <Ruler size={11} />, label: t("routing_panel.when_min_prompt", { n: String(when.min_prompt_chars) }) });
    if (Number.isFinite(when.max_prompt_chars))
      chips.push({ icon: <Ruler size={11} />, label: t("routing_panel.when_max_prompt", { n: String(when.max_prompt_chars) }) });
    if (Number.isFinite(when.min_context_chars))
      chips.push({ icon: <Ruler size={11} />, label: t("routing_panel.when_min_context", { n: String(when.min_context_chars) }) });
    if (Array.isArray(when.channels) && when.channels.length > 0)
      chips.push({ icon: <Radio size={11} />, label: t("routing_panel.when_channels", { list: when.channels.join(", ") }) });
    if (Array.isArray(when.keywords) && when.keywords.length > 0)
      chips.push({ icon: <Hash size={11} />, label: t("routing_panel.when_keywords", { list: when.keywords.join(", ") }) });
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((c, i) => (
        <span key={i} className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-fg">
          {c.icon} {c.label}
        </span>
      ))}
    </div>
  );
}

export function RoutingPanel() {
  const toast = useToast();
  const { config, isLoading, patch } = useGlobalConfig();

  const [enabled, setEnabled] = useState(false);
  const [rulesText, setRulesText] = useState("[]");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Snapshot of the saved state, for dirty tracking.
  const [saved, setSaved] = useState<{ enabled: boolean; rulesText: string }>({ enabled: false, rulesText: "[]" });

  useEffect(() => {
    const routing = (config.super_agent?.routing || {}) as { enabled?: boolean; rules?: RoutingRule[] };
    const rules = Array.isArray(routing.rules) ? routing.rules : [];
    const text = JSON.stringify(rules, null, 2);
    setEnabled(routing.enabled === true);
    setRulesText(text);
    setSaved({ enabled: routing.enabled === true, rulesText: text });
  }, [config.super_agent?.routing]);

  // Parse the editor buffer live: the list preview and save both use this.
  const parsed = useMemo<{ rules: RoutingRule[]; error: string | null }>(() => {
    try {
      const v = JSON.parse(rulesText);
      if (!Array.isArray(v)) return { rules: [], error: t("routing_panel.json_not_array") };
      return { rules: v as RoutingRule[], error: null };
    } catch (e) {
      return { rules: [], error: t("routing_panel.json_error", { msg: (e as Error).message }) };
    }
  }, [rulesText]);

  if (isLoading) return <Loading />;

  const rules = parsed.rules;
  const ruleCount = rules.length;
  // Normalize for dirty compare so whitespace-only edits don't count.
  const normalizedText = parsed.error ? rulesText : JSON.stringify(rules);
  const savedNormalized = (() => { try { return JSON.stringify(JSON.parse(saved.rulesText)); } catch { return saved.rulesText; } })();
  const dirty = enabled !== saved.enabled || normalizedText !== savedNormalized;

  const doSave = async () => {
    if (parsed.error) return;
    setBusy(true);
    try {
      await patch({ "super_agent.routing": { enabled, rules } });
      toast.success(t("routing_panel.saved_toast"));
      const text = JSON.stringify(rules, null, 2);
      setRulesText(text);
      setSaved({ enabled, rulesText: text });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  };

  const signalOn = enabled && ruleCount > 0;

  return (
    <div data-testid="routing-panel">
      <Section title={t("routing_panel.title")} description={t("routing_panel.description")}>
        <div className="space-y-4">
          {/* Active/inactive signal — the user wants a clear "it's on" cue. */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/20 p-3">
            <span data-testid="routing-signal">
              {signalOn ? (
                <Badge tone="success">
                  <RouteIcon size={11} /> {t("routing_panel.signal_on", { n: String(ruleCount) })}
                </Badge>
              ) : enabled ? (
                <Badge tone="warning">
                  <RouteIcon size={11} /> {t("routing_panel.signal_on_empty")}
                </Badge>
              ) : (
                <Badge tone="muted">
                  <RouteIcon size={11} /> {t("routing_panel.signal_off")}
                </Badge>
              )}
            </span>
            <Tip content={t("routing_panel.helper")}>
              <span className="text-xs text-muted-fg underline decoration-dotted underline-offset-2">
                {t("routing_panel.how_it_works")}
              </span>
            </Tip>
          </div>

          <Switch checked={enabled} onChange={setEnabled} label={t("routing_panel.enable_label")} />

          {/* Rules preview */}
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium">{t("routing_panel.rules_title")}</div>
                <div className="text-xs text-muted-fg">{t("routing_panel.rules_desc")}</div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setEditing((v) => !v)}>
                {editing ? t("routing_panel.hide_editor") : t("routing_panel.edit_rules")}
              </Button>
            </div>

            <ul className="space-y-1.5">
              {rules.map((r, i) => (
                <li key={i} className="rounded-md bg-card px-2.5 py-2 text-xs">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="w-6 text-muted-fg">#{i + 1}</span>
                    <span className="font-mono text-[12px]">{r.model || "—"}</span>
                  </div>
                  <div className="pl-8">
                    <WhenChips when={r.when} />
                  </div>
                </li>
              ))}
              {ruleCount === 0 && !parsed.error && (
                <li className="text-xs text-muted-fg">{t("routing_panel.rules_empty")}</li>
              )}
            </ul>
          </div>

          {/* JSON editor for the rules array */}
          {editing && (
            <Field label={t("routing_panel.editor_label")} hint={t("routing_panel.json_hint")}>
              <Textarea
                rows={10}
                className="font-mono text-xs"
                value={rulesText}
                onChange={(e) => setRulesText(e.target.value)}
                spellCheck={false}
              />
              {parsed.error ? (
                <span className="mt-1 block text-[11px] text-red-400">{parsed.error}</span>
              ) : (
                <button
                  type="button"
                  className="mt-1 text-[11px] text-muted-fg underline decoration-dotted underline-offset-2"
                  onClick={() => setRulesText(JSON.stringify(EXAMPLE_RULES, null, 2))}
                >
                  {t("routing_panel.insert_example")}
                </button>
              )}
            </Field>
          )}

          <p className="text-[11px] leading-relaxed text-muted-fg">{t("routing_panel.helper")}</p>

          <Button
            variant="primary"
            loading={busy}
            disabled={!dirty || !!parsed.error}
            onClick={() => setConfirmOpen(true)}
          >
            {dirty ? t("routing_panel.save") : t("routing_panel.saved")}
          </Button>
        </div>
      </Section>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t("routing_panel.confirm_title")}
        description={t("routing_panel.confirm_body")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>{t("routing_panel.cancel")}</Button>
            <Button variant="primary" loading={busy} onClick={doSave}>{t("routing_panel.confirm_apply")}</Button>
          </>
        }
      >
        <p className="text-sm text-muted-fg">
          {enabled ? t("routing_panel.confirm_on", { n: String(ruleCount) }) : t("routing_panel.confirm_off")}
        </p>
      </Dialog>
    </div>
  );
}
