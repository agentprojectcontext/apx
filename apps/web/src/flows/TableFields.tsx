// Save to table and Read table around the project's tables (DECISIONS.md#d-173, #d-176): both pick any table of the
// project or make a new one on the spot, empty, and add columns as they go. A save fills a value per column (or keeps
// one value whole); a read gets one key or the latest rows, and later steps read each column.
import type { TableInfo } from "@apx/protocol";
import { Field, Icons, SegmentedControl, Select } from "@apx/ui";
import { useState } from "react";
import { useT } from "../i18n/index.ts";
import { InputPicker } from "./InputPicker.tsx";
import { NewName } from "./NewName.tsx";
import type { FlowGraph, FlowNode } from "./steps.tsx";
import { Template, type Values } from "./Template.tsx";
import { addColumn, columnName, createTable, useTables } from "./tables-data.ts";
import { ownTable, tableName } from "./values.ts";
import "./tables.css";

type Write = Extract<FlowNode, { kind: "table_write" }>;
type Read = Extract<FlowNode, { kind: "table_read" }>;
type T = ReturnType<typeof useT>;
const NEW = "+new";
const OWN = "+own";
const COUNTS = [1, 5, 10, 25, 50];
const rowsText = (n: number, t: T) =>
  t(n === 1 ? "flow.tbl.rowsOne" : n === 0 ? "flow.tbl.empty" : "flow.tbl.rows", { n });

/** Which table: any of the project's, or a new one made right here. */
function TablePick({
  n,
  projectId,
  tables,
  onTable,
}: {
  n: Write | Read;
  projectId: string;
  tables: TableInfo[] | undefined;
  onTable: (table: TableInfo | undefined) => void;
}) {
  const t = useT();
  const [naming, setNaming] = useState(false);
  const own = n.table === undefined && ownTable(n);
  // A table named in the drawing that the project no longer has stays visible, so the issue can be read.
  const gone = n.table !== undefined && tables !== undefined && !tables.some((x) => x.name === n.table);
  return (
    <>
      <Field label={t("flow.tbl.table")} hint={gone ? t("flow.tbl.gone") : undefined}>
        {() => (
          <Select
            label={t("flow.tbl.table")}
            value={naming ? NEW : (n.table ?? (own ? OWN : null))}
            placeholder={tables && !tables.length ? t("flow.tbl.noneYet") : t("flow.tbl.choose")}
            onValueChange={(v) => {
              setNaming(v === NEW);
              if (v !== NEW) onTable(tables?.find((x) => x.name === v));
            }}
            options={[
              ...(tables ?? []).map((s) => ({ value: s.name, label: s.name, hint: rowsText(s.rows, t) })),
              ...(gone && n.table ? [{ value: n.table, label: n.table, hint: t("flow.tbl.goneShort") }] : []),
              ...(own ? [{ value: OWN, label: t("flow.tbl.own") }] : []),
              { value: NEW, label: t("flow.tbl.new") },
            ]}
          />
        )}
      </Field>
      {naming && projectId && (
        <NewName
          open
          label={t("flow.tbl.new")}
          field={t("flow.tbl.newName")}
          placeholder="leads"
          clean={tableName}
          onCancel={() => setNaming(false)}
          create={async (name) => {
            const { table } = await createTable(projectId, name);
            setNaming(false);
            onTable(table);
          }}
        />
      )}
    </>
  );
}

/** "New column" on the chosen table: made at once, empty in every row. */
function NewColumn({ projectId, table, onAdded }: { projectId: string; table: string; onAdded?: (c: string) => void }) {
  const t = useT();
  return (
    <NewName
      label={t("flow.tbl.newColumn")}
      field={t("flow.tbl.newColumnName")}
      placeholder="phone"
      clean={columnName}
      create={async (name) => {
        await addColumn(projectId, table, name);
        onAdded?.(name);
      }}
    />
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
  const tables = useTables(projectId || undefined);
  const chosen = tables?.find((x) => x.name === n.table);
  const byColumn = n.columns !== undefined;
  const { value: _v, columns: _c, ...base } = n;
  /** By column keeps what is filled; whole saves what reached the step. */
  const mode = (column: boolean, table = n.table) =>
    column
      ? { ...base, ...(table ? { table } : {}), columns: n.columns ?? [] }
      : { ...base, ...(table ? { table } : {}), value: n.value ?? { kind: "event" as const, path: [] } };
  const cell = (name: string) => n.columns?.find((c) => c.name === name)?.value ?? "";
  const setCell = (name: string, value: string) => {
    const rest = (n.columns ?? []).filter((c) => c.name !== name);
    const next = value ? [...rest, { name, value }] : rest;
    // In the table's order, so the drawing reads like the table.
    const order = chosen?.columns ?? [];
    update({ ...mode(true), columns: next.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name)) });
  };
  const from = n.value?.kind === "node" ? n.value.node : undefined;
  const what = from ? graph.nodes.find((x) => x.id === from)?.label : undefined;
  return (
    <>
      <TablePick
        n={n}
        projectId={projectId}
        tables={tables}
        onTable={(table) => {
          if (!table) return update(ownTable(n) ? { ...base, value: n.value ?? { kind: "event", path: [] } } : n);
          // A table with columns is filled column by column; an empty one keeps what arrives whole.
          update(mode(byColumn || table.columns.length > 0, table.name));
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
      {n.table && (
        <div className="fe-presets">
          <span className="fe-ins__label">{t("flow.tbl.saves")}</span>
          <SegmentedControl
            size="sm"
            label={t("flow.tbl.saves")}
            value={byColumn ? "column" : "whole"}
            onValueChange={(v) => update(mode(v === "column"))}
            options={[
              { value: "column", label: t("flow.tbl.byColumn") },
              { value: "whole", label: t("flow.tbl.whole") },
            ]}
          />
        </div>
      )}
      {byColumn && chosen ? (
        <div className="ft-columns">
          {chosen.columns.length === 0 && <p className="fe-note">{t("flow.tbl.noColumns")}</p>}
          {chosen.columns.map((c) => (
            <Field key={c} label={c}>
              {(id) => (
                <Template
                  id={id}
                  field="column"
                  values={values}
                  singleLine
                  spellCheck={false}
                  maxLength={8000}
                  value={cell(c)}
                  placeholder={t("flow.tbl.cellEmpty")}
                  onValueChange={(v) => setCell(c, v)}
                />
              )}
            </Field>
          ))}
          <NewColumn projectId={projectId} table={chosen.name} />
        </div>
      ) : (
        !byColumn && (
          <>
            <InputPicker
              label={t("flow.f.saveWhat")}
              graph={graph}
              n={n}
              value={n.value ?? { kind: "event", path: [] }}
              onChange={(value) => update({ ...n, value })}
            />
            {n.table && <p className="fe-note">{t("flow.tbl.wholeNote")}</p>}
          </>
        )
      )}
      <div className="fe-row-preview">
        <span className="fe-ins__label">{t("flow.tbl.rowLooks")}</span>
        <div className="fe-row-preview__row">
          <code className="apx-tfield__chip">{n.key.trim() || t("flow.f.key")}</code>
          <Icons.ArrowRight size={12} />
          <span>
            {byColumn
              ? (n.columns ?? []).map((c) => c.name).join(", ") || t("flow.tbl.nothingYet")
              : what
                ? t("flow.f.fromStep", { step: what })
                : n.value?.kind === "event" && n.value.path.length
                  ? n.value.path.join(".")
                  : t("flow.f.fromEvent")}
          </span>
        </div>
      </div>
      <p className="fe-note">{t(byColumn ? "flow.tbl.saveNoteColumns" : "flow.f.saveNote")}</p>
    </>
  );
}

export function TableReadFields({
  n,
  projectId,
  values,
  update,
}: {
  n: Read;
  graph: FlowGraph;
  projectId: string;
  values: Values;
  update: (n: FlowNode) => void;
}) {
  const t = useT();
  const tables = useTables(projectId || undefined);
  const chosen = tables?.find((x) => x.name === n.table);
  const latest = n.latest !== undefined;
  return (
    <>
      <TablePick
        n={n}
        projectId={projectId}
        tables={tables}
        onTable={(table) => {
          const { table: _t, latest: _l, ...rest } = n;
          update(
            table
              ? { ...rest, table: table.name, ...(n.latest ? { latest: n.latest } : {}) }
              : { ...rest, keys: n.keys },
          );
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
      {chosen && (
        <div className="ft-columns">
          <span className="fe-ins__label">{t("flow.tbl.columns")}</span>
          {chosen.columns.length ? (
            <div className="ft-chips">
              {chosen.columns.map((c) => (
                <code key={c} className="apx-tfield__chip">
                  $steps.{n.id}.{c}
                </code>
              ))}
            </div>
          ) : (
            <p className="fe-note">{t("flow.tbl.noColumnsRead")}</p>
          )}
          <NewColumn projectId={projectId} table={chosen.name} />
          {chosen.rows === 0 && <p className="fe-note">{t("flow.tbl.emptyNote")}</p>}
        </div>
      )}
      <p className="fe-note">{t(latest ? "flow.tbl.noteLatest" : "flow.tbl.noteKey", { step: n.id })}</p>
    </>
  );
}
