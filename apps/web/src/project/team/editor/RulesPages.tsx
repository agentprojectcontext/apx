// The agent editor's permission pages: autonomy (with its budget), rules by case and the browser profile.
import {
  type Agent,
  AUTONOMY_RULES,
  type Autonomy,
  type Result,
  type RulePolicy,
  type ToolApproval,
  type ToolRisk,
} from "@apx/protocol";
import { Button, Dialog, SegmentedControl } from "@apx/ui";
import { type ReactNode, useState } from "react";
import { type MessageKey, useT } from "../../../i18n/index.ts";
import { AgentBudgetField } from "../AgentBudgetField.tsx";
import { type Draft, effectiveRule, POLICIES, RISKS } from "./draft.ts";

type Catalog = Result<"agents.tools">["tools"];
type PageProps = { agent: Agent; draft: Draft; edit: (patch: Partial<Draft>) => void };

const AUTONOMIES: readonly Autonomy[] = ["ask", "standard", "edits", "total"];
const AUTONOMY_KEY: Record<Autonomy, MessageKey> = {
  ask: "agentedit.autonomyAsk",
  standard: "agentedit.autonomyStandard",
  edits: "agentedit.autonomyEdits",
  total: "agentedit.autonomyTotal",
};
const RISK_TONE: Record<ToolRisk, string> = {
  read: "agentedit__risk-read",
  write: "agentedit__risk-write",
  outside: "agentedit__risk-outside",
  irreversible: "agentedit__risk-irreversible",
};

/** One choice of a single-pick list (autonomy, browser profile): a native radio drawn as a row. */
function Choice(props: {
  name: string;
  on: boolean;
  label: string;
  description: string;
  tag?: string | undefined;
  onPick(): void;
}) {
  return (
    <label className={`agentedit__choice${props.on ? " is-on" : ""}`}>
      <input
        type="radio"
        name={props.name}
        className="agentedit__radioinput"
        checked={props.on}
        onChange={props.onPick}
      />
      <span className="agentedit__radio" aria-hidden />
      <span className="agentedit__choicetext">
        <span className="agentedit__choicelabel">{props.label}</span>
        <span className="agentedit__choicedesc">{props.description}</span>
      </span>
      {props.tag && <span className="agentedit__tag">{props.tag}</span>}
    </label>
  );
}

function Choices({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="agentedit__choices">
      <legend className="agentedit__legend">{label}</legend>
      {children}
    </fieldset>
  );
}

const polKey = (p: RulePolicy): MessageKey => `agentedit.pol.${p}`;

export function AutonomyPage({
  agent,
  draft: d,
  edit,
  projectAutonomy,
  onRules,
}: PageProps & { projectAutonomy: Autonomy; onRules(): void }) {
  const t = useT();
  return (
    <>
      <Choices label={t("agentedit.page.autonomy")}>
        <Choice
          name="autonomy"
          on={!d.autonomy}
          label={t("agentedit.autonomyProject")}
          description={t(AUTONOMY_KEY[projectAutonomy])}
          tag={t("agentedit.fromProjectTag")}
          onPick={() => edit({ autonomy: "" })}
        />
        {AUTONOMIES.map((a) => (
          <Choice
            key={a}
            name="autonomy"
            on={d.autonomy === a}
            label={t(AUTONOMY_KEY[a])}
            description={t(`${AUTONOMY_KEY[a]}Hint` as MessageKey)}
            onPick={() => edit({ autonomy: a })}
          />
        ))}
      </Choices>
      <div className="agentedit__summary">
        <span>{t("agentedit.summary")}</span>
        {RISKS.map((r) => {
          const p = effectiveRule(d, projectAutonomy, r);
          return (
            <span key={r} className={`agentedit__pill ${RISK_TONE[r]}`}>
              <span className="agentedit__riskdot" aria-hidden />
              {t(`agentedit.risk.${r}`)} · <span className={`agentedit__pol is-${p}`}>{t(polKey(p))}</span>
            </span>
          );
        })}
        <button type="button" className="agentedit__link" onClick={onRules}>
          {t("agentedit.adjust")}
        </button>
      </div>
      {Object.keys(d.rules).length > 0 && <p className="config__hint">{t("agentedit.ownRulesNote")}</p>}
      <h3 className="config__sub">{t("agentedit.budget")}</h3>
      <p className="config__lead">{t("agentedit.budgetHint")}</p>
      <AgentBudgetField agentId={agent.id} />
    </>
  );
}

export function RulesPage({
  agent,
  draft: d,
  edit,
  catalog,
  granted,
  projectAutonomy,
  projectName,
  onAutonomy,
}: PageProps & {
  catalog: Catalog | undefined;
  granted: ToolApproval[];
  projectAutonomy: Autonomy;
  projectName: string;
  onAutonomy(): void;
}) {
  const t = useT();
  const [leaving, setLeaving] = useState<{ risk: ToolRisk; policy: RulePolicy }>();
  const inherits = !d.autonomy && !Object.keys(d.rules).length;
  const level = d.autonomy || projectAutonomy;
  const grantedTools = new Set(granted.map((g) => g.tool));
  // Going from the project's to its own: every case becomes its own, so the project no longer changes it.
  const set = (risk: ToolRisk, policy: RulePolicy) =>
    inherits ? setLeaving({ risk, policy }) : edit({ rules: { ...d.rules, [risk]: policy } });
  const reset = (risk: ToolRisk) => {
    const { [risk]: _gone, ...rest } = d.rules;
    edit({ rules: rest });
  };
  return (
    <>
      <div className="agentedit__base">
        <span>
          {d.autonomy
            ? t("agentedit.rulesBaseOwn", { level: t(AUTONOMY_KEY[level]) })
            : t("agentedit.rulesBaseProject", { project: projectName, level: t(AUTONOMY_KEY[level]) })}
        </span>
        <button type="button" className="agentedit__link" onClick={onAutonomy}>
          {t("agentedit.changeAutonomy")}
        </button>
      </div>
      {Object.keys(d.rules).length > 0 && (
        <div className="agentedit__note">
          <span>{t("agentedit.ownRulesNote")}</span>
          <button type="button" className="agentedit__link" onClick={() => edit({ rules: {} })}>
            {t("agentedit.backToProject")}
          </button>
        </div>
      )}
      {RISKS.map((risk) => {
        const policy = effectiveRule(d, projectAutonomy, risk);
        const own = d.rules[risk] !== undefined;
        const names = (catalog ?? []).filter((x) => x.risk === risk && !x.kept).map((x) => x.name);
        const exceptions = names.filter((n) => grantedTools.has(n) && policy !== "auto");
        return (
          <section key={risk} className={`agentedit__tier ${RISK_TONE[risk]}`}>
            <div className="agentedit__tierhead">
              <span className="agentedit__riskdot" aria-hidden />
              <div className="agentedit__tiertext">
                <div className="agentedit__tiertitle">
                  {t(`agentedit.risk.${risk}`)}
                  {own && (
                    <>
                      <span className="agentedit__tag is-info">{t("agentedit.ruleOwn")}</span>
                      <button type="button" className="agentedit__link" onClick={() => reset(risk)}>
                        {t("agentedit.ruleReset")}
                      </button>
                    </>
                  )}
                </div>
                <div className="agentedit__tierdesc">{t(`agentedit.risk.${risk}Hint`)}</div>
              </div>
              <SegmentedControl
                size="sm"
                label={t(`agentedit.risk.${risk}`)}
                value={policy}
                onValueChange={(v) => set(risk, v as RulePolicy)}
                options={POLICIES.map((p) => ({ value: p, label: t(polKey(p)) }))}
              />
            </div>
            {names.length > 0 && (
              <div className="agentedit__chips">
                {names.slice(0, 6).map((n) => (
                  <code key={n} className="agentedit__chip">
                    {n}
                  </code>
                ))}
                {names.length > 6 && <span className="agentedit__chip">+{names.length - 6}</span>}
              </div>
            )}
            {exceptions.length > 0 && (
              <div className={`agentedit__tiernote${risk === "irreversible" ? " is-danger" : ""}`}>
                {t("agentedit.grantedRun", {
                  count: exceptions.length,
                  tools: exceptions.slice(0, 3).join(", ") + (exceptions.length > 3 ? "…" : ""),
                })}
              </div>
            )}
          </section>
        );
      })}
      {leaving && (
        <Dialog
          open
          onOpenChange={(o) => !o && setLeaving(undefined)}
          title={t("agentedit.leaveProjectTitle")}
          footer={
            <>
              <Button variant="secondary" onClick={() => setLeaving(undefined)}>
                {t("common.cancel")}
              </Button>
              <Button
                onClick={() => {
                  edit({ rules: { ...AUTONOMY_RULES[projectAutonomy], [leaving.risk]: leaving.policy } });
                  setLeaving(undefined);
                }}
              >
                {t("agentedit.leaveProjectOk")}
              </Button>
            </>
          }
        >
          <p className="agentedit__warn">
            {t("agentedit.leaveProjectBody", { name: agent.name, project: projectName })}
          </p>
        </Dialog>
      )}
    </>
  );
}

const PROFILES: ReadonlyArray<Agent["browser_profile"]> = ["shared", "isolated", "incognito"];

export function BrowserPage({
  draft: d,
  edit,
  projectAutonomy,
  onRules,
}: PageProps & { projectAutonomy: Autonomy; onRules(): void }) {
  const t = useT();
  return (
    <>
      <Choices label={t("agentedit.page.browser")}>
        {PROFILES.map((p) => (
          <Choice
            key={p}
            name="browser"
            on={d.browser_profile === p}
            label={t(`agentedit.browser.${p}`)}
            description={t(`agentedit.browser.${p}Hint`)}
            onPick={() => edit({ browser_profile: p })}
          />
        ))}
      </Choices>
      <p className="config__hint">
        {t("agentedit.browserHint", {
          policy: t(polKey(effectiveRule(d, projectAutonomy, "outside"))).toLowerCase(),
        })}{" "}
        <button type="button" className="agentedit__link" onClick={onRules}>
          {t("agentedit.risk.outside")}
        </button>
      </p>
    </>
  );
}
