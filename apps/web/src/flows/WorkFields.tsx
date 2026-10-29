// Settings of variables, code, SQL and commands (DECISIONS.md#d-170); a check's cases are in CaseFields.tsx. Values from what arrived reach
// SQL and commands only as bound values, variables and input, so those fields take placeholders and the query and
// the command's text never do.
import { Button, Field, IconButton, Icons, Input, SegmentedControl, Switch, Textarea } from "@apx/ui";
import { type ReactNode, useEffect, useState } from "react";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import type { FlowNode } from "./steps.tsx";
import { Template, type Values } from "./Template.tsx";

type Vars = Extract<FlowNode, { kind: "vars" }>;
type Js = Extract<FlowNode, { kind: "js" }>;
type Sql = Extract<FlowNode, { kind: "sql" }>;
type Cmd = Extract<FlowNode, { kind: "cmd" }>;
type Literal = string | number | boolean | null;
type Update = (n: FlowNode) => void;

type Value = { kind: "literal"; value: Literal } | { kind: "expr"; expr: string };
type ValueKind = "text" | "number" | "bool" | "expr";
const kindOf = (v: Value): ValueKind =>
  v.kind === "expr" ? "expr" : typeof v.value === "number" ? "number" : typeof v.value === "boolean" ? "bool" : "text";
const fresh = (k: ValueKind): Value =>
  k === "expr" ? { kind: "expr", expr: "" } : { kind: "literal", value: k === "number" ? 0 : k === "bool" ? true : "" };

/**
 * What a case compares with or a variable holds: text, a number, yes or no, or a formula over what came before. The
 * label and its kind sit on one line, the value under them. `text` is the field a text value is typed in: a variable's
 * may hold a secret (picked like any value), a case compares as typed.
 */
function ValueField({
  label,
  value,
  onChange,
  values,
  text,
  placeholder,
}: {
  label: string;
  value: Value;
  onChange: (v: Value) => void;
  values: Values;
  text?: "varText";
  placeholder: string;
}) {
  const t = useT();
  const kind = kindOf(value);
  const literal = value.kind === "literal" ? value.value : null;
  return (
    <div className="fe-value">
      <div className="fe-value__head">
        <span className="fe-ins__label">{label}</span>
        <SegmentedControl
          size="sm"
          label={t("flow.f.type")}
          value={kind}
          onValueChange={(k) => k !== kind && onChange(fresh(k as ValueKind))}
          options={[
            { value: "text", label: t("flow.f.text") },
            { value: "number", label: t("flow.f.number") },
            { value: "bool", label: t("flow.f.bool") },
            { value: "expr", label: t("flow.f.caseFormula") },
          ]}
        />
      </div>
      {value.kind === "expr" ? (
        <Template
          aria-label={t("flow.f.caseFormula")}
          field="formula"
          values={values}
          singleLine
          className="fe-mono"
          spellCheck={false}
          maxLength={1000}
          value={value.expr}
          placeholder={placeholder}
          onValueChange={(expr) => onChange({ kind: "expr", expr })}
        />
      ) : typeof literal === "boolean" ? (
        <SegmentedControl
          size="sm"
          label={label}
          value={literal ? "yes" : "no"}
          onValueChange={(v) => onChange({ kind: "literal", value: v === "yes" })}
          options={[
            { value: "yes", label: t("flow.f.yes") },
            { value: "no", label: t("flow.f.no") },
          ]}
        />
      ) : typeof literal === "number" ? (
        <Input
          aria-label={label}
          value={String(literal)}
          inputMode="decimal"
          onChange={(e) => onChange({ kind: "literal", value: Number(e.target.value.replace(",", ".")) || 0 })}
        />
      ) : text ? (
        <Template
          aria-label={label}
          field={text}
          values={values}
          singleLine
          maxLength={8000}
          value={String(literal ?? "")}
          onValueChange={(v) => onChange({ kind: "literal", value: v })}
        />
      ) : (
        <Input
          aria-label={label}
          value={String(literal ?? "")}
          onChange={(e) => onChange({ kind: "literal", value: e.target.value })}
        />
      )}
    </div>
  );
}

/** One case or variable in a flat list: its name as the line's title, a remove button, then its value. */
export function Item({
  name,
  nameLabel,
  placeholder,
  mono,
  onName,
  remove,
  children,
}: {
  name: string;
  nameLabel: string;
  placeholder?: string;
  mono?: boolean;
  onName: (v: string) => void;
  remove?: { label: string; run: () => void } | undefined;
  children: ReactNode;
}) {
  return (
    <section className="fe-item" aria-label={name || placeholder}>
      <div className="fe-item__head">
        <Input
          size="sm"
          className={mono ? "fe-item__name fe-mono" : "fe-item__name"}
          aria-label={nameLabel}
          value={name}
          maxLength={64}
          placeholder={placeholder}
          spellCheck={false}
          onChange={(e) => onName(e.target.value)}
        />
        {remove && <IconButton size="sm" label={remove.label} icon={<Icons.X size={12} />} onClick={remove.run} />}
      </div>
      {children}
    </section>
  );
}

/** Variables: each a name later steps read as $vars.name, and a value (a secret among them) or a formula. */
export function VarsFields({ n, update, values }: { n: Vars; update: Update; values: Values }) {
  const t = useT();
  const set = (i: number, v: Vars["vars"][number]) => update({ ...n, vars: n.vars.map((x, j) => (j === i ? v : x)) });
  return (
    <>
      <div className="fe-list">
        <span className="fe-ins__label">{t("flow.f.vars")}</span>
        {n.vars.map((v, i) => (
          <Item
            // biome-ignore lint/suspicious/noArrayIndexKey: a variable's name is what is being typed
            key={i}
            name={v.name}
            nameLabel={t("flow.f.varName")}
            mono
            onName={(name) => set(i, { ...v, name: name.replace(/[^A-Za-z0-9_]/g, "_") })}
            remove={
              n.vars.length > 1
                ? {
                    label: t("flow.f.varRemove", { name: v.name }),
                    run: () => update({ ...n, vars: n.vars.filter((_, j) => j !== i) }),
                  }
                : undefined
            }
          >
            <ValueField
              label={t("flow.f.varValue")}
              value={v.value}
              values={values}
              text="varText"
              placeholder="$trigger.price * $trigger.qty"
              onChange={(value) => set(i, { ...v, value })}
            />
          </Item>
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

export function SqlFields({ n, update, values }: { n: Sql; update: Update; values: Values }) {
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
          <Template
            id={id}
            field="sqlValue"
            values={values}
            rows={3}
            className="fe-mono"
            spellCheck={false}
            value={lines.box}
            placeholder="email: $trigger.email"
            onValueChange={(next) => {
              lines.setBox(next);
              update({ ...n, params: lines.parse(next).list });
            }}
          />
        )}
      </Field>
      <p className="fe-note">{t(n.mode === "read" ? "flow.f.sqlNoteRead" : "flow.f.sqlNoteWrite", { step: n.id })}</p>
    </>
  );
}

export function CmdFields({
  n,
  update,
  values,
  projectId,
}: {
  n: Cmd;
  update: Update;
  values: Values;
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
          <Template
            id={id}
            field="env"
            values={values}
            rows={3}
            className="fe-mono"
            spellCheck={false}
            value={lines.box}
            placeholder="EMAIL=$trigger.email"
            onValueChange={(next) => {
              lines.setBox(next);
              update({ ...n, env: lines.parse(next).list });
            }}
          />
        )}
      </Field>
      <Field label={t("flow.f.stdin")} hint={t("flow.f.stdinHint")}>
        {(id) => (
          <Template
            id={id}
            field="stdin"
            values={values}
            rows={3}
            className="fe-mono"
            spellCheck={false}
            maxLength={16000}
            value={n.stdin}
            onValueChange={(stdin) => update({ ...n, stdin })}
          />
        )}
      </Field>
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
