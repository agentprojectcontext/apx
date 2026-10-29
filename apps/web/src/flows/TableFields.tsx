// Save to table and Read table, around the project's tables (DECISIONS.md#d-173): a save picks one of them or names a
// new one; a read picks one, saying how many rows it has, and reads one key or the latest rows. A table a save earlier
// in the drawing names is offered first, before it has any row.
import { Button, Field, Icons, Input, SegmentedControl, Select } from "@apx/ui";
import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { useT } from "../i18n/index.ts";
import { InputPicker } from "./InputPicker.tsx";
import type { FlowGraph, FlowNode } from "./steps.tsx";
import { Template, type Values } from "./Template.tsx";
import { ownTable, savedTableBefore, tableName } from "./values.ts";

type Write = Extract<FlowNode, { kind: "table_write" }>;
type Read = Extract<FlowNode, { kind: "table_read" }>;
type Stored = { name: string; rows: number; updated_at: string };
const NEW = "+new";
const OWN = "+own";
const COUNTS = [1, 5, 10, 25, 50];
const rowsText = (n: number, t: ReturnType<typeof useT>) => t(n === 1 ? "flow.tbl.rowsOne" : "flow.tbl.rows", { n });

/** The project's tables with their rows, and the tables this drawing saves to by the step that saves there. */
function useTables(projectId: string, graph: FlowGraph) {
  const [stored, setStored] = useState<Stored[]>();
  useEffect(() => {
    let live = true;
    void client.call("flows.tables", { project: projectId }).then(
      (r) => live && setStored(r.tables),
      () => live && setStored([]),
    );
    return () => {
      live = false;
    };
  }, [projectId]);
  const drawn = new Map<string, string>();
  for (const n of graph.nodes)
    if (n.kind === "table_write" && n.table && !drawn.has(n.table)) drawn.set(n.table, n.label);
  return { stored, drawn };
}

/** Which table: one of the list, or a new one typed by name (a save only). */
function TablePick({
  n,
  options,
  creates,
  onTable,
}: {
  n: Write | Read;
  options: { value: string; label: string; hint?: string }[];
  creates: boolean;
  onTable: (table: string | undefined) => void;
}) {
  const t = useT();
  const [naming, setNaming] = useState(false);
  const listed = n.table !== undefined && options.some((o) => o.value === n.table);
  const typing = creates && (naming || (n.table !== undefined && !listed));
  const own = n.table === undefined && ownTable(n) && !naming;
  return (
    <>
      <Field label={t("flow.tbl.table")}>
        {() => (
          <Select
            label={t("flow.tbl.table")}
            value={typing ? NEW : listed ? (n.table ?? null) : own ? OWN : null}
            placeholder={t("flow.tbl.choose")}
            onValueChange={(v) => {
              if (v === NEW) {
                setNaming(true);
                onTable(undefined);
              } else {
                setNaming(false);
                onTable(v && v !== OWN ? v : undefined);
              }
            }}
            options={[
              ...options,
              ...(own ? [{ value: OWN, label: t("flow.tbl.own") }] : []),
              ...(creates ? [{ value: NEW, label: t("flow.tbl.new") }] : []),
            ]}
          />
        )}
      </Field>
      {typing && (
        <Field label={t("flow.tbl.newName")} hint={t("flow.tbl.newHint")}>
          {(id) => (
            <Input
              id={id}
              autoFocus={naming && !n.table}
              className="fe-mono"
              spellCheck={false}
              value={n.table ?? ""}
              placeholder="leads"
              onChange={(e) => onTable(tableName(e.target.value) || undefined)}
            />
          )}
        </Field>
      )}
    </>
  );
}

export function TableWriteFields({
  n,
  graph,
  projectId,
  values,
  update,
}: {
  n: Write;
  graph: FlowGraph;
  projectId: string;
  values: Values;
  update: (n: FlowNode) => void;
}) {
  const t = useT();
  const { stored, drawn } = useTables(projectId, graph);
  const options = [
    ...(stored ?? []).map((s) => ({ value: s.name, label: s.name, hint: rowsText(s.rows, t) })),
    ...[...drawn]
      .filter(([name]) => name !== n.table && !stored?.some((s) => s.name === name))
      .map(([name]) => ({ value: name, label: name, hint: t("flow.tbl.new") })),
  ];
  const from = n.value.kind === "node" ? n.value.node : undefined;
  const what = from ? graph.nodes.find((x) => x.id === from)?.label : undefined;
  return (
    <>
      <TablePick
        n={n}
        options={options}
        creates
        onTable={(table) => {
          const { table: _t, ...rest } = n;
          update(table ? { ...rest, table } : rest);
        }}
      />
      <Field label={t("flow.f.key")} hint={t("flow.tbl.keyHint")}>
        {(id) => (
          <Template
            id={id}
            field="key"
            values={values}
            singleLine
            className="fe-mono"
            spellCheck={false}
            maxLength={128}
            value={n.key}
            placeholder="$trigger.email"
            onValueChange={(key) => update({ ...n, key })}
          />
        )}
      </Field>
      <InputPicker
        label={t("flow.f.saveWhat")}
        graph={graph}
        n={n}
        value={n.value}
        onChange={(value) => update({ ...n, value })}
      />
      <div className="fe-row-preview">
        <span className="fe-ins__label">{t("flow.tbl.rowLooks")}</span>
        <div className="fe-row-preview__row">
          <code className="apx-tfield__chip">{n.key.trim() || t("flow.f.key")}</code>
          <Icons.ArrowRight size={12} />
          <span>
            {what
              ? t("flow.f.fromStep", { step: what })
              : n.value.kind === "event" && n.value.path.length
                ? n.value.path.join(".")
                : t("flow.f.fromEvent")}
          </span>
        </div>
      </div>
      <p className="fe-note">{t("flow.f.saveNote")}</p>
    </>
  );
}

export function TableReadFields({
  n,
  graph,
  projectId,
  values,
  update,
  addSave,
}: {
  n: Read;
  graph: FlowGraph;
  projectId: string;
  values: Values;
  update: (n: FlowNode) => void;
  /** Puts a save step before this read, for a project with no table yet. */
  addSave: () => void;
}) {
  const t = useT();
  const { stored, drawn } = useTables(projectId, graph);
  const before = savedTableBefore(graph, n.id);
  // What a save earlier in this drawing names comes first: it is what this read most likely wants.
  const names = [...new Set([...(before ? [before] : []), ...drawn.keys(), ...(stored ?? []).map((s) => s.name)])];
  const options = names.map((name) => {
    const s = stored?.find((x) => x.name === name);
    return {
      value: name,
      label: name,
      hint: s ? rowsText(s.rows, t) : t("flow.tbl.savedBy", { step: drawn.get(name) ?? "" }),
    };
  });
  const latest = n.latest !== undefined;
  if (stored && !options.length && !ownTable(n))
    return (
      <div className="fe-empty-tables">
        <p className="fe-note">{t("flow.tbl.none")}</p>
        <Button size="sm" variant="outline" leadingIcon={<Icons.Plus size={14} />} onClick={addSave}>
          {t("flow.tbl.addSave")}
        </Button>
      </div>
    );
  return (
    <>
      <TablePick
        n={n}
        options={options}
        creates={false}
        onTable={(table) => {
          const { table: _t, latest: _l, ...rest } = n;
          update(table ? { ...rest, table, ...(n.latest ? { latest: n.latest } : {}) } : { ...rest, keys: n.keys });
        }}
      />
      {n.table && (
        <div className="fe-presets">
          <span className="fe-ins__label">{t("flow.tbl.reads")}</span>
          <SegmentedControl
            size="sm"
            label={t("flow.tbl.reads")}
            value={latest ? "latest" : "key"}
            onValueChange={(v) => {
              const { latest: _l, ...rest } = n;
              update(v === "latest" ? { ...rest, keys: [], latest: 10 } : { ...rest, keys: [""] });
            }}
            options={[
              { value: "key", label: t("flow.tbl.oneKey") },
              { value: "latest", label: t("flow.tbl.latest") },
            ]}
          />
        </div>
      )}
      {latest ? (
        <div className="fe-presets">
          <span className="fe-ins__label">{t("flow.tbl.howMany")}</span>
          <SegmentedControl
            size="sm"
            label={t("flow.tbl.howMany")}
            value={String(n.latest)}
            onValueChange={(v) => update({ ...n, latest: Number(v) })}
            options={COUNTS.map((c) => ({ value: String(c), label: String(c) }))}
          />
        </div>
      ) : (
        <Field label={t("flow.f.key")} hint={t("flow.tbl.readKeyHint")}>
          {(id) => (
            <Template
              id={id}
              field="key"
              values={values}
              singleLine
              className="fe-mono"
              spellCheck={false}
              maxLength={128}
              value={n.keys[0] ?? ""}
              placeholder="$trigger.email"
              onValueChange={(key) => update({ ...n, keys: [key, ...n.keys.slice(1)] })}
            />
          )}
        </Field>
      )}
      <p className="fe-note">{t(latest ? "flow.tbl.noteLatest" : "flow.tbl.noteKey", { step: n.id })}</p>
    </>
  );
}
