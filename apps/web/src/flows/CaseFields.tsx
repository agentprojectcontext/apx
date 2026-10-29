// A check's cases (DECISIONS.md#d-170, #d-180): each its name, then Compare or Formula, then the inputs in place.
// A comparison is a field, how it compares and what with, both sides from the `{}` picker; two or more join by "and"
// or "or". A case drawn as "its field is a value" shows as one comparison and is kept that way once edited.
import {
  FLOW_CASE_RULES,
  FLOW_OPS_BY_TYPE,
  type FlowCase,
  type FlowComparison,
  flowCases,
} from "@apx/protocol/flow-cases";
import { Button, IconButton, Icons, SegmentedControl, Select } from "@apx/ui";
import { useT } from "../i18n/index.ts";
import { newComparison, OP_LABEL, type RulesMatch, TYPE_LABEL, withOp, withType } from "./compare.ts";
import { nextCaseId, withCases } from "./graph-edit.ts";
import { branchesOf, type FlowNode } from "./steps.tsx";
import { Template, type Values } from "./Template.tsx";
import { Item } from "./WorkFields.tsx";
import "./cases.css";

type Condition = Extract<FlowNode, { kind: "condition" }>;
type Update = (n: FlowNode) => void;

/** A case drawn as "the check's field is this value", as the comparison it is. */
function asRules(c: FlowCase, input: Condition["input"]): RulesMatch | undefined {
  if (c.match.kind === "all" || c.match.kind === "any") return c.match;
  if (c.match.kind !== "equals") return undefined;
  const v = c.match.value;
  const left =
    input.kind === "event"
      ? ["$trigger", ...input.path].join(".")
      : input.kind === "node"
        ? ["$steps", input.node, ...input.path].join(".")
        : "";
  const type = typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : "text";
  return { kind: "all", rules: [{ left, op: "equals", right: v === null ? "" : String(v), type }] };
}

/** One comparison: the field, then its type, how it compares and what with. */
function Comparison({
  rule,
  n,
  values,
  onChange,
  remove,
}: {
  rule: FlowComparison;
  n: number;
  values: Values;
  onChange: (r: FlowComparison) => void;
  remove?: (() => void) | undefined;
}) {
  const t = useT();
  const alone = rule.op === "empty" || rule.op === "not_empty";
  return (
    <fieldset className="fe-rule" aria-label={t("flow.f.ruleN", { n })}>
      <div className="fe-rule__head">
        <Template
          aria-label={t("flow.f.ruleField")}
          field="compare"
          values={values}
          singleLine
          className="fe-mono"
          spellCheck={false}
          maxLength={1000}
          value={rule.left}
          placeholder={t("flow.f.ruleFieldHint")}
          onValueChange={(left) => onChange({ ...rule, left })}
        />
        {remove && (
          <IconButton size="sm" label={t("flow.f.ruleRemove", { n })} icon={<Icons.X size={12} />} onClick={remove} />
        )}
      </div>
      <SegmentedControl
        size="sm"
        label={t("flow.f.type")}
        value={rule.type}
        onValueChange={(v) => onChange(withType(rule, v as FlowComparison["type"]))}
        options={(["text", "number", "boolean"] as const).map((k) => ({ value: k, label: t(TYPE_LABEL[k]) }))}
      />
      <div className="fe-rule__row">
        <Select
          size="sm"
          label={t("flow.f.ruleOp")}
          value={rule.op}
          onValueChange={(v) => v && onChange(withOp(rule, v as FlowComparison["op"]))}
          options={FLOW_OPS_BY_TYPE[rule.type].map((op) => ({ value: op, label: t(OP_LABEL[op]) }))}
        />
        {alone ? null : rule.type === "boolean" && (rule.right === "true" || rule.right === "false") ? (
          <SegmentedControl
            size="sm"
            label={t("flow.f.ruleValue")}
            value={rule.right === "true" ? "yes" : "no"}
            onValueChange={(v) => onChange({ ...rule, right: v === "yes" ? "true" : "false" })}
            options={[
              { value: "yes", label: t("flow.f.yes") },
              { value: "no", label: t("flow.f.no") },
            ]}
          />
        ) : (
          <Template
            aria-label={t("flow.f.ruleValue")}
            field="compare"
            values={values}
            singleLine
            spellCheck={false}
            maxLength={1000}
            value={rule.right}
            placeholder={rule.type === "number" ? "100" : t("flow.f.ruleValueHint")}
            onValueChange={(right) => onChange({ ...rule, right })}
          />
        )}
      </div>
    </fieldset>
  );
}

/** A case's comparisons, joined by "and" (all) or "or" (any) once there are two. */
function Rules({ match, values, onChange }: { match: RulesMatch; values: Values; onChange: (m: RulesMatch) => void }) {
  const t = useT();
  const set = (rules: FlowComparison[]) => onChange({ kind: match.kind, rules });
  return (
    <div className="fe-rules">
      {match.rules.map((r, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a comparison has no name of its own
        <div key={i} className="fe-rules__item">
          {i > 0 && (
            <SegmentedControl
              size="sm"
              className="fe-rules__join"
              label={t("flow.f.join")}
              value={match.kind}
              onValueChange={(k) => onChange({ kind: k as RulesMatch["kind"], rules: match.rules })}
              options={[
                { value: "all", label: t("flow.f.and") },
                { value: "any", label: t("flow.f.or") },
              ]}
            />
          )}
          <Comparison
            rule={r}
            n={i + 1}
            values={values}
            onChange={(next) => set(match.rules.map((x, j) => (j === i ? next : x)))}
            remove={match.rules.length > 1 ? () => set(match.rules.filter((_, j) => j !== i)) : undefined}
          />
        </div>
      ))}
      {match.rules.length < FLOW_CASE_RULES && (
        <Button
          size="sm"
          variant="ghost"
          className="fe-rules__add"
          leadingIcon={<Icons.Plus size={14} />}
          onClick={() => set([...match.rules, newComparison()])}
        >
          {t("flow.f.ruleAdd")}
        </Button>
      )}
    </div>
  );
}

/** A check: its cases in order, each comparisons or a formula, then otherwise. */
export function CaseFields({
  n,
  update,
  removeCase,
  values,
}: {
  n: Condition;
  update: Update;
  removeCase: (id: string) => void;
  values: Values;
}) {
  const t = useT();
  const cases = flowCases(n);
  const names = branchesOf(n, t);
  const set = (i: number, c: FlowCase) => update({ ...withCases(n), cases: cases.map((x, j) => (j === i ? c : x)) });
  return (
    <>
      <div className="fe-list">
        <span className="fe-ins__label">{t("flow.f.cases")}</span>
        {cases.map((c, i) => {
          const rules = asRules(c, n.input);
          return (
            <Item
              key={c.id}
              name={c.label}
              nameLabel={t("flow.f.caseName")}
              placeholder={names[i]?.label}
              onName={(label) => set(i, { ...c, label: label.slice(0, 60) })}
              remove={
                cases.length > 1
                  ? { label: t("flow.f.caseRemove", { name: names[i]?.label ?? "" }), run: () => removeCase(c.id) }
                  : undefined
              }
            >
              <SegmentedControl
                size="sm"
                label={t("flow.f.caseKind")}
                value={rules ? "rules" : "expr"}
                onValueChange={(k) =>
                  set(i, {
                    ...c,
                    match: k === "expr" ? { kind: "expr", expr: "" } : { kind: "all", rules: [newComparison()] },
                  })
                }
                options={[
                  { value: "rules", label: t("flow.f.caseCompare") },
                  { value: "expr", label: t("flow.f.caseFormula") },
                ]}
              />
              {rules ? (
                <Rules match={rules} values={values} onChange={(match) => set(i, { ...c, match })} />
              ) : (
                <div className="fe-value">
                  <Template
                    aria-label={t("flow.f.caseFormula")}
                    field="formula"
                    values={values}
                    singleLine
                    className="fe-mono"
                    spellCheck={false}
                    maxLength={1000}
                    value={c.match.kind === "expr" ? c.match.expr : ""}
                    placeholder="$trigger.amount > 100"
                    onValueChange={(expr) => set(i, { ...c, match: { kind: "expr", expr } })}
                  />
                  <span className="fe-ins__muted">{t("flow.f.formulaHint")}</span>
                </div>
              )}
            </Item>
          );
        })}
        <div className="fe-item is-otherwise">
          <span className="fe-item__else">{names.at(-1)?.label}</span>
          <span className="fe-ins__muted">{t("flow.f.otherwiseHint")}</span>
        </div>
      </div>
      {cases.length < 15 && (
        <Button
          size="sm"
          variant="outline"
          leadingIcon={<Icons.Plus size={14} />}
          onClick={() =>
            update({
              ...withCases(n),
              cases: [...cases, { id: nextCaseId(n), label: "", match: { kind: "all", rules: [newComparison()] } }],
            })
          }
        >
          {t("flow.f.caseAdd")}
        </Button>
      )}
      <p className="fe-note">{t("flow.f.caseNote")}</p>
    </>
  );
}
