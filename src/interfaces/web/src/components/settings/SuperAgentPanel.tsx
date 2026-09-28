import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Cpu } from "lucide-react";
import { Section } from "../Section";
import { Button, Field, Input, Loading, Textarea, Switch } from "../ui";
import { UiSelect } from "../UiSelect";
import { useToast } from "../Toast";
import { useGlobalConfig, useSuperAgentConfig } from "../../hooks/useGlobalConfig";
import { useIdentity } from "../../hooks/useIdentity";
import { PERMISSION_MODES } from "../../constants";
import { t } from "../../i18n";
import { AgentIconPicker } from "../agents/AgentFormFields";
import { SUPER_AGENT_ICON } from "../agents/AgentAvatar";
import { ModelPicker } from "../chat/ModelPicker";

const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
type RiskLevel = (typeof RISK_LEVELS)[number];

// A number field where "" means "use the default": stored as 0, which every
// resolver in core reads as unset.
const toBudget = (v: string) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
// A value equal to the built-in default shows as the placeholder and saves as
// 0, so pressing Save never pins today's default into config.json.
const fromBudget = (n?: number, def?: number) => (n && n > 0 && n !== def ? String(n) : "");

export function SuperAgentPanel() {
  const toast = useToast();
  const navigate = useNavigate();
  const { superAgent, isLoading, mutate } = useSuperAgentConfig();
  const { patch } = useGlobalConfig();
  const { identity, save: saveIdentity } = useIdentity();

  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [system, setSystem] = useState("");
  const [personality, setPersonality] = useState("");
  const [icon, setIcon] = useState(SUPER_AGENT_ICON);
  const [perm, setPerm] = useState<string>("permiso");
  const [selfModel, setSelfModel] = useState("");
  const [selfFallback, setSelfFallback] = useState(true);
  const [riskOn, setRiskOn] = useState(false);
  const [riskAt, setRiskAt] = useState<RiskLevel>("HIGH");
  const [riskUnknown, setRiskUnknown] = useState(true);
  const [stuckOn, setStuckOn] = useState(true);
  const [judgeContinue, setJudgeContinue] = useState(true);
  const [judgeVerify, setJudgeVerify] = useState(false);
  const [spendOn, setSpendOn] = useState(true);
  const [spendCalls, setSpendCalls] = useState("");
  const [spendProject, setSpendProject] = useState("");
  const [spendPause, setSpendPause] = useState("");
  const [tgIters, setTgIters] = useState("");
  const [webIters, setWebIters] = useState("");
  const [routineIters, setRoutineIters] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!superAgent) return;
    setEnabled(!!superAgent.enabled);
    setSystem(superAgent.system || "");
    setPerm(superAgent.permission_mode || "permiso");
    setIcon(superAgent.icon || SUPER_AGENT_ICON);
    setSelfModel(superAgent.self_model || "");
    setSelfFallback(superAgent.self_model_fallback !== false);
    setRiskOn(!!superAgent.security_risk?.enabled);
    setRiskAt(superAgent.security_risk?.confirm_at || "HIGH");
    setRiskUnknown(superAgent.security_risk?.confirm_unknown !== false);
    setStuckOn(superAgent.stuck_detection?.enabled !== false);
    setJudgeContinue(superAgent.judge?.continue_unfinished !== false);
    setJudgeVerify(!!superAgent.judge?.enabled);
    setSpendOn(superAgent.spend_breaker?.enabled !== false);
    const sd = superAgent.defaults?.spend_breaker;
    setSpendCalls(fromBudget(superAgent.spend_breaker?.calls_per_hour, sd?.calls_per_hour));
    setSpendProject(fromBudget(superAgent.spend_breaker?.project_calls_per_hour, sd?.project_calls_per_hour));
    setSpendPause(fromBudget(superAgent.spend_breaker?.pause_min, sd?.pause_min));
    setTgIters(fromBudget(superAgent.telegram_max_iters));
    setWebIters(fromBudget(superAgent.web_max_iters));
    setRoutineIters(fromBudget(superAgent.routine_max_iters));
  }, [superAgent]);

  useEffect(() => {
    setPersonality(identity.personality || "");
    setName(identity.agent_name || "");
  }, [identity.personality, identity.agent_name]);

  if (isLoading || !superAgent) return <Loading />;

  const submit = async () => {
    setBusy(true);
    try {
      await patch({
        "super_agent.enabled":          enabled,
        "super_agent.system":           system,
        "super_agent.permission_mode":  perm,
        "super_agent.icon":             icon,
        "super_agent.self_model":       selfModel,
        "super_agent.self_model_fallback": selfFallback,
        "super_agent.security_risk.enabled":         riskOn,
        "super_agent.security_risk.confirm_at":      riskAt,
        "super_agent.security_risk.confirm_unknown": riskUnknown,
        "super_agent.stuck_detection.enabled":       stuckOn,
        "super_agent.judge.continue_unfinished":     judgeContinue,
        "super_agent.judge.enabled":                 judgeVerify,
        "super_agent.spend_breaker.enabled":                spendOn,
        "super_agent.spend_breaker.calls_per_hour":         toBudget(spendCalls),
        "super_agent.spend_breaker.project_calls_per_hour": toBudget(spendProject),
        "super_agent.spend_breaker.pause_min":              toBudget(spendPause),
        "super_agent.telegram_max_iters": toBudget(tgIters),
        "super_agent.web_max_iters":      toBudget(webIters),
        "super_agent.routine_max_iters":  toBudget(routineIters),
      }, ["super_agent.name"]);
      await saveIdentity({ personality, agent_name: name.trim() });
      toast.success(t("settings.super_agent.saved"));
      mutate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  };

  const d = superAgent.defaults;

  return (
    <Section
      title={t("settings.super_agent.title")}
      description={t("settings.super_agent.behavior_subtitle")}
      action={<Button variant="primary" loading={busy} onClick={submit}>{t("common.save")}</Button>}
    >
      <div className="grid gap-x-8 gap-y-6 lg:grid-cols-2" data-testid="super-agent-columns">
        {/* ── Left: who it is ─────────────────────────────────────────── */}
        <div className="space-y-4">
          {/* The textareas size to their content (field-sizing-content), so
              `rows` does nothing — min-h is what gives them room to write. */}
          <Group title={t("settings.super_agent.section_identity")}>
            <Field label={t("settings.super_agent.name")} hint={t("settings.super_agent.name_hint")}>
              <Input
                value={name}
                placeholder="APX"
                maxLength={40}
                onChange={(e) => setName(e.target.value)}
                data-testid="super-agent-name"
              />
            </Field>
            <Switch checked={enabled} onChange={setEnabled} label={t("settings.super_agent.enabled_label")} />
            <Field label={t("settings.super_agent.avatar")} hint={t("settings.super_agent.avatar_hint")}>
              <AgentIconPicker icon={icon} onIcon={(next) => setIcon(next || SUPER_AGENT_ICON)} />
            </Field>
            <Field label={t("settings.super_agent.personality")}>
              <Textarea className="min-h-40" value={personality} onChange={(e) => setPersonality(e.target.value)} />
            </Field>
            <Field label={t("settings.super_agent.system")} hint={t("settings.super_agent.system_hint")}>
              <Textarea
                className="min-h-48 font-mono text-xs"
                value={system}
                onChange={(e) => setSystem(e.target.value)}
                placeholder={t("settings.super_agent.system_ph")}
              />
            </Field>
          </Group>
        </div>

        {/* ── Right: how it runs ──────────────────────────────────────── */}
        <div className="space-y-4">
          <Group title={t("settings.super_agent.section_model")}>
            {/* Its OWN model first: the router's #1 is also what every agent with
                `Model: inherit` runs on, so it cannot double as the super-agent's. */}
            <Field label={t("settings.super_agent.self_model")} hint={t("settings.super_agent.self_model_hint")}>
              <div className="w-fit max-w-full rounded-md border border-border px-2 py-1" data-testid="super-agent-self-model">
                <ModelPicker value={selfModel} onChange={setSelfModel} disabled={busy} />
              </div>
            </Field>
            {selfModel && (
              <Switch
                checked={selfFallback}
                onChange={setSelfFallback}
                label={t("settings.super_agent.self_model_fallback")}
              />
            )}

            {/* The router it falls back to (or runs on, with no own model). Dimmed
                when a strict own model means the router is never reached. The
                model itself lives in the Router — single source of truth. */}
            <div
              className={`flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 p-3 ${selfModel && !selfFallback ? "opacity-50" : ""}`}
              aria-disabled={!!selfModel && !selfFallback}
              data-testid="super-agent-router-card"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium">{t("settings.super_agent.model_active")}</div>
                <div className="truncate font-mono text-xs text-muted-fg">{superAgent.model || "—"}</div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => navigate("/p/0/models")}>
                <Cpu size={13} /> {t("settings.super_agent.model_configure")}
              </Button>
            </div>

            <Field label={t("settings.super_agent.permission_mode")} hint={t("settings_ui.cfg_permission_hint")}>
              <UiSelect value={perm} onChange={setPerm} options={PERMISSION_MODES.map((m) => ({ value: m, label: m }))} />
            </Field>
          </Group>

          <Group title={t("settings.super_agent.section_guards")} hint={t("settings.super_agent.all_agents_hint")}>
            <Toggle checked={riskOn} onChange={setRiskOn} label={t("settings.super_agent.risk_label")} hint={t("settings.super_agent.risk_hint")}>
              {riskOn && (
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <span className="text-xs text-muted-fg">{t("settings.super_agent.risk_confirm_at")}</span>
                  <div className="w-32">
                    <UiSelect
                      value={riskAt}
                      onChange={(v) => setRiskAt(v as RiskLevel)}
                      options={RISK_LEVELS.map((r) => ({ value: r, label: r }))}
                    />
                  </div>
                  <Switch checked={riskUnknown} onChange={setRiskUnknown} label={t("settings.super_agent.risk_unknown")} />
                </div>
              )}
            </Toggle>
            <Toggle checked={stuckOn} onChange={setStuckOn} label={t("settings.super_agent.stuck_label")} hint={t("settings.super_agent.stuck_hint")} />
            <Toggle checked={judgeContinue} onChange={setJudgeContinue} label={t("settings.super_agent.judge_continue_label")} hint={t("settings.super_agent.judge_continue_hint")} />
            <Toggle checked={judgeVerify} onChange={setJudgeVerify} label={t("settings.super_agent.judge_verify_label")} hint={t("settings.super_agent.judge_verify_hint")} />
            <Toggle checked={spendOn} onChange={setSpendOn} label={t("settings.super_agent.spend_label")} hint={t("settings.super_agent.spend_hint")}>
              {spendOn && (
                <div className="mt-2 grid grid-cols-3 gap-3">
                  <Field label={t("settings.super_agent.spend_calls")}>
                    <Input type="number" min={1} value={spendCalls} placeholder={String(d?.spend_breaker?.calls_per_hour ?? "")} onChange={(e) => setSpendCalls(e.target.value)} />
                  </Field>
                  <Field label={t("settings.super_agent.spend_project_calls")}>
                    <Input type="number" min={1} value={spendProject} placeholder={String(d?.spend_breaker?.project_calls_per_hour ?? "")} onChange={(e) => setSpendProject(e.target.value)} />
                  </Field>
                  <Field label={t("settings.super_agent.spend_pause")}>
                    <Input type="number" min={1} value={spendPause} placeholder={String(d?.spend_breaker?.pause_min ?? "")} onChange={(e) => setSpendPause(e.target.value)} />
                  </Field>
                </div>
              )}
            </Toggle>
          </Group>

          <Group title={t("settings.super_agent.section_budgets")} hint={t("settings.super_agent.budgets_hint")}>
            <div className="grid grid-cols-3 gap-3">
              <Field label={t("settings.super_agent.budget_telegram")}>
                <Input type="number" min={1} value={tgIters} placeholder={String(d?.telegram_max_iters ?? "")} onChange={(e) => setTgIters(e.target.value)} />
              </Field>
              <Field label={t("settings.super_agent.budget_web")}>
                <Input type="number" min={1} value={webIters} placeholder={String(d?.web_max_iters ?? "")} onChange={(e) => setWebIters(e.target.value)} />
              </Field>
              <Field label={t("settings.super_agent.budget_routine")}>
                <Input type="number" min={1} value={routineIters} placeholder={String(d?.routine_max_iters ?? "")} onChange={(e) => setRoutineIters(e.target.value)} />
              </Field>
            </div>
          </Group>
        </div>
      </div>
    </Section>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-2.5">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-fg">{title}</h3>
        {hint && <p className="mt-0.5 text-[11px] text-muted-fg">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

// A switch with its explanation underneath, and room for the knobs it unlocks.
function Toggle({ checked, onChange, label, hint, children }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
  children?: ReactNode;
}) {
  return (
    <div>
      <Switch checked={checked} onChange={onChange} label={label} />
      <p className="pl-11 text-[11px] text-muted-fg">{hint}</p>
      {children && <div className="pl-11">{children}</div>}
    </div>
  );
}
