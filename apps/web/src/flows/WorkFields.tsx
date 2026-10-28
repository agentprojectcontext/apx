// Settings of a check's cases, variables, code, SQL and commands (DECISIONS.md#d-170). Values from what arrived reach
// SQL and commands only as bound values, variables and input, so those fields take placeholders and the query and
// the command's text never do.
import { flowCases } from "@apx/protocol/flow-cases";
import { Button, Field, IconButton, Icons, Input, SegmentedControl, Switch, Textarea } from "@apx/ui";
import { useEffect, useState } from "react";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { nextCaseId, withCases } from "./graph-edit.ts";
import { Insert, type Token } from "./OutwardFields.tsx";
import { branchesOf, dotted, type FlowNode } from "./steps.tsx";

type Condition = Extract<FlowNode, { kind: "condition" }>;
type Vars = Extract<FlowNode, { kind: "vars" }>;
type Js = Extract<FlowNode, { kind: "js" }>;
type Sql = Extract<FlowNode, { kind: "sql" }>;
type Cmd = Extract<FlowNode, { kind: "cmd" }>;
type Literal = string | number | boolean | null;
type Update = (n: FlowNode) => void;

const appended = (text: string, token: string) => (text && !/\s$/.test(text) ? `${text} ${token}` : `${text}${token}`);
const typeOf = (v: Literal) => (typeof v === "number" ? "number" : typeof v === "boolean" ? "bool" : "text");

/** A value typed as text, a number or yes/no, for a case to compare with or a variable to hold. */
function LiteralField({ label, value, onChange }: { label: string; value: Literal; onChange: (v: Literal) => void }) {
  const t = useT();
  const kind = typeOf(value);
  return (
    <>
      <SegmentedControl
        size="sm"
        label={t("flow.f.type")}
        value={kind}
        onValueChange={(v) => onChange(v === "number" ? 0 : v === "bool" ? true : "")}
        options={[
          { value: "text", label: t("flow.f.text") },
          { value: "number", label: t("flow.f.number") },
          { value: "bool", label: t("flow.f.bool") },
        ]}
      />
      {typeof value === "boolean" ? (
        <SegmentedControl
          size="sm"
          label={label}
          value={value ? "yes" : "no"}
          onValueChange={(v) => onChange(v === "yes")}
          options={[
            { value: "yes", label: t("flow.f.yes") },
            { value: "no", label: t("flow.f.no") },
          ]}
        />
      ) : (
        <Field label={label}>
          {(id) => (
            <Input
              id={id}
              value={String(value ?? "")}
              inputMode={typeof value === "number" ? "decimal" : undefined}
              onChange={(e) =>
                onChange(typeof value === "number" ? Number(e.target.value.replace(",", ".")) || 0 : e.target.value)
              }
            />
          )}
        </Field>
      )}
    </>
  );
}

/** A check: its cases in order, each a value its field must have or a formula that must hold, then otherwise. */
export function CaseFields({
  n,
  update,
  removeCase,
}: {
  n: Condition;
  update: Update;
  removeCase: (id: string) => void;
}) {
  const t = useT();
  const cases = flowCases(n);
  const names = branchesOf(n, t);
  const set = (i: number, c: (typeof cases)[number]) =>
    update({ ...withCases(n), cases: cases.map((x, j) => (j === i ? c : x)) });
  const compares = cases.some((c) => c.match.kind === "equals");
  const path = n.input.kind === "event" ? dotted(n.input.path) : "";
  return (
    <>
      {compares && (
        <Field label={t("flow.f.field")} hint={t("flow.f.fieldHint")}>
          {(id) => (
            <Input
              id={id}
              value={path}
              className="fe-mono"
              onChange={(e) =>
                update({
                  ...n,
                  input: {
                    kind: "event",
                    path: e.target.value
                      .split(".")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  },
                })
              }
            />
          )}
        </Field>
      )}
      <div className="fe-cases">
        {cases.map((c, i) => (
          <fieldset key={c.id} className="fe-case" aria-label={names[i]?.label}>
            <div className="fe-case__head">
              <Input
                aria-label={t("flow.f.caseName")}
                value={c.label}
                maxLength={60}
                placeholder={names[i]?.label}
                onChange={(e) => set(i, { ...c, label: e.target.value })}
              />
              {cases.length > 1 && (
                <IconButton
                  label={t("flow.f.caseRemove", { name: names[i]?.label ?? "" })}
                  icon={<Icons.X size={12} />}
                  onClick={() => removeCase(c.id)}
                />
              )}
            </div>
            <SegmentedControl
              size="sm"
              label={t("flow.f.caseKind")}
              value={c.match.kind}
              onValueChange={(v) =>
                set(i, {
                  ...c,
                  match: v === "expr" ? { kind: "expr", expr: "" } : { kind: "equals", value: "" },
                })
              }
              options={[
                { value: "equals", label: t("flow.f.caseIs") },
                { value: "expr", label: t("flow.f.caseFormula") },
              ]}
            />
            {c.match.kind === "equals" ? (
              <LiteralField
                label={t("flow.f.varValue")}
                value={c.match.value}
                onChange={(value) => set(i, { ...c, match: { kind: "equals", value } })}
              />
            ) : (
              <Input
                aria-label={t("flow.f.caseFormula")}
                value={c.match.expr}
                maxLength={1000}
                className="fe-mono"
                spellCheck={false}
                placeholder="$trigger.amount > 100"
                onChange={(e) => set(i, { ...c, match: { kind: "expr", expr: e.target.value } })}
              />
            )}
          </fieldset>
        ))}
        <div className="fe-case is-otherwise">
          <span className="fe-case__else">{names.at(-1)?.label}</span>
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
              cases: [...cases, { id: nextCaseId(n), label: "", match: { kind: "expr", expr: "" } }],
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

/** Variables: each a name later steps read as $vars.name, and a value or a formula over what came before. */
export function VarsFields({ n, update }: { n: Vars; update: Update }) {
  const t = useT();
  const set = (i: number, v: Vars["vars"][number]) => update({ ...n, vars: n.vars.map((x, j) => (j === i ? v : x)) });
  return (
    <>
      <div className="fe-cases">
        {n.vars.map((v, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a variable's name is what is being typed
          <fieldset key={i} className="fe-case" aria-label={v.name}>
            <div className="fe-case__head">
              <Input
                aria-label={t("flow.f.varName")}
                value={v.name}
                maxLength={64}
                className="fe-mono"
                spellCheck={false}
                onChange={(e) => set(i, { ...v, name: e.target.value.replace(/[^A-Za-z0-9_]/g, "_") })}
              />
              {n.vars.length > 1 && (
                <IconButton
                  label={t("flow.f.varRemove", { name: v.name })}
                  icon={<Icons.X size={12} />}
                  onClick={() => update({ ...n, vars: n.vars.filter((_, j) => j !== i) })}
                />
              )}
            </div>
            <SegmentedControl
              size="sm"
              label={t("flow.f.caseKind")}
              value={v.value.kind}
              onValueChange={(k) =>
                set(i, {
                  ...v,
                  value: k === "expr" ? { kind: "expr", expr: "" } : { kind: "literal", value: "" },
                })
              }
              options={[
                { value: "literal", label: t("flow.f.varValue") },
                { value: "expr", label: t("flow.f.caseFormula") },
              ]}
            />
            {v.value.kind === "literal" ? (
              <LiteralField
                label={t("flow.f.varValue")}
                value={v.value.value}
                onChange={(value) => set(i, { ...v, value: { kind: "literal", value } })}
              />
            ) : (
              <Input
                aria-label={t("flow.f.caseFormula")}
                value={v.value.expr}
                maxLength={1000}
                className="fe-mono"
                spellCheck={false}
                placeholder="$trigger.price * $trigger.qty"
                onChange={(e) => set(i, { ...v, value: { kind: "expr", expr: e.target.value } })}
              />
            )}
          </fieldset>
        ))}
      </div>
      {n.vars.length < 16 && (
        <Button
          size="sm"
          variant="outline"
          leadingIcon={<Icons.Plus size={14} />}
          onClick={() =>
            update({
              ...n,
              vars: [...n.vars, { name: `value${n.vars.length + 1}`, value: { kind: "literal", value: "" } }],
            })
          }
        >
          {t("flow.f.varAdd")}
        </Button>
      )}
      <p className="fe-note">{t("flow.f.varsNote")}</p>
    </>
  );
}

const LIMITS_JS = [1000, 2000, 5000, 10000];
const LIMITS_CMD = [10000, 30000, 60000, 120000];
/** "2 s", "1 min". */
const span = (ms: number) => (ms >= 60000 ? `${ms / 60000} min` : `${ms / 1000} s`);

function TimeLimit({ value, options, onChange }: { value: number; options: number[]; onChange: (ms: number) => void }) {
  const t = useT();
  return (
    <div className="fe-presets">
      <span className="fe-ins__label">{t("flow.f.timeLimit")}</span>
      <SegmentedControl
        size="sm"
        label={t("flow.f.timeLimit")}
        value={String(options.includes(value) ? value : options[0])}
        onValueChange={(v) => onChange(Number(v))}
        options={options.map((ms) => ({ value: String(ms), label: span(ms) }))}
      />
    </div>
  );
}

/** The code of a JavaScript step; what it receives is picked below it. */
export function JsFields({ n, update }: { n: Js; update: Update }) {
  const t = useT();
  return (
    <>
      <Field label={t("flow.f.code")} hint={t("flow.f.codeHint")}>
        {(id) => (
          <Textarea
            id={id}
            rows={8}
            maxLength={8000}
            className="fe-mono"
            spellCheck={false}
            value={n.code}
            onChange={(e) => update({ ...n, code: e.target.value })}
          />
        )}
      </Field>
      <TimeLimit value={n.timeoutMs} options={LIMITS_JS} onChange={(timeoutMs) => update({ ...n, timeoutMs })} />
    </>
  );
}

/** `name: value` lines, the way people write them; a line it can't read is kept in the box, not in the step. */
function useLines<T extends { name: string; value: string }>(
  id: string,
  items: T[],
  sep: ":" | "=",
  name: RegExp,
  max: number,
) {
  const text = (list: T[]) => list.map((x) => `${x.name}${sep === ":" ? ": " : "="}${x.value}`).join("\n");
  const [box, setBox] = useState(() => text(items));
  // Another step chosen: its own lines.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the step changes, not on each keystroke
  useEffect(() => setBox(text(items)), [id]);
  const parse = (value: string) => {
    const out: { name: string; value: string }[] = [];
    let bad = false;
    for (const line of value.split("\n")) {
      if (!line.trim()) continue;
      const at = line.indexOf(sep);
      const key = at < 0 ? "" : line.slice(0, at).trim();
      if (at > 0 && name.test(key) && out.length < max)
        out.push({
          name: key,
          value: line
            .slice(at + 1)
            .replace(/^\s/, "")
            .trimEnd(),
        });
      else bad = true;
    }
    return { list: out, bad };
  };
  return { box, setBox, parse, bad: parse(box).bad };
}

export function SqlFields({ n, update, tokens }: { n: Sql; update: Update; tokens: Token[] }) {
  const t = useT();
  const lines = useLines(n.id, n.params, ":", /^[A-Za-z_][A-Za-z0-9_]{0,63}$/, 32);
  return (
    <>
      <Field label={t("flow.f.database")} hint={t("flow.f.databaseHint")}>
        {(id) => (
          <Input
            id={id}
            value={n.database}
            maxLength={500}
            className="fe-mono"
            spellCheck={false}
            placeholder="data/app.db"
            onChange={(e) => update({ ...n, database: e.target.value })}
          />
        )}
      </Field>
      <Switch
        size="sm"
        checked={n.mode === "read"}
        onCheckedChange={(on) => update({ ...n, mode: on ? "read" : "write" })}
        label={t("flow.f.readOnly")}
        description={t(n.mode === "read" ? "flow.f.readOnlyOn" : "flow.f.readOnlyOff")}
      />
      <Field label={t("flow.f.query")}>
        {(id) => (
          <Textarea
            id={id}
            rows={6}
            maxLength={8000}
            className="fe-mono"
            spellCheck={false}
            value={n.query}
            placeholder="SELECT * FROM leads WHERE email = :email"
            onChange={(e) => update({ ...n, query: e.target.value })}
          />
        )}
      </Field>
      <Field label={t("flow.f.values")} hint={lines.bad ? t("flow.f.valuesBad") : t("flow.f.valuesHint")}>
        {(id) => (
          <Textarea
            id={id}
            rows={3}
            className="fe-mono"
            spellCheck={false}
            value={lines.box}
            placeholder="email: $trigger.email"
            onChange={(e) => {
              lines.setBox(e.target.value);
              update({ ...n, params: lines.parse(e.target.value).list });
            }}
          />
        )}
      </Field>
      <Insert
        tokens={tokens}
        onInsert={(token) => {
          const next = appended(lines.box, token);
          lines.setBox(next);
          update({ ...n, params: lines.parse(next).list });
        }}
      />
      <p className="fe-note">{t(n.mode === "read" ? "flow.f.sqlNoteRead" : "flow.f.sqlNoteWrite", { step: n.id })}</p>
    </>
  );
}

export function CmdFields({
  n,
  update,
  tokens,
  projectId,
}: {
  n: Cmd;
  update: Update;
  tokens: Token[];
  projectId: string;
}) {
  const t = useT();
  const project = useData((s) => s.projects.find((p) => p.id === projectId));
  const lines = useLines(n.id, n.env, "=", /^[A-Za-z_][A-Za-z0-9_]{0,63}$/, 16);
  return (
    <>
      <Field label={t("flow.f.command")}>
        {(id) => (
          <Textarea
            id={id}
            rows={4}
            maxLength={4000}
            className="fe-mono"
            spellCheck={false}
            value={n.command}
            placeholder="./scripts/sync.sh"
            onChange={(e) => update({ ...n, command: e.target.value })}
          />
        )}
      </Field>
      <div className="fe-copy">
        <span className="fe-ins__label">{t("flow.f.folder")}</span>
        <span className="fe-ins__muted fe-mono fe-folder">{project?.path ?? project?.name ?? "…"}</span>
      </div>
      <Field label={t("flow.f.env")} hint={lines.bad ? t("flow.f.envBad") : t("flow.f.envHint")}>
        {(id) => (
          <Textarea
            id={id}
            rows={3}
            className="fe-mono"
            spellCheck={false}
            value={lines.box}
            placeholder="EMAIL=$trigger.email"
            onChange={(e) => {
              lines.setBox(e.target.value);
              update({ ...n, env: lines.parse(e.target.value).list });
            }}
          />
        )}
      </Field>
      <Field label={t("flow.f.stdin")} hint={t("flow.f.stdinHint")}>
        {(id) => (
          <Textarea
            id={id}
            rows={3}
            className="fe-mono"
            spellCheck={false}
            maxLength={16000}
            value={n.stdin}
            onChange={(e) => update({ ...n, stdin: e.target.value })}
          />
        )}
      </Field>
      <Insert tokens={tokens} onInsert={(token) => update({ ...n, stdin: appended(n.stdin, token) })} />
      <TimeLimit value={n.timeoutMs} options={LIMITS_CMD} onChange={(timeoutMs) => update({ ...n, timeoutMs })} />
      <Switch
        size="sm"
        checked={n.continueOnError}
        onCheckedChange={(continueOnError) => update({ ...n, continueOnError })}
        label={t("flow.f.goOn")}
        description={t("flow.f.goOnHint")}
      />
      <p className="fe-note">{t("flow.f.cmdNote", { step: n.id })}</p>
    </>
  );
}
