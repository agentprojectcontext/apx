// The Flows screen's Tables (DECISIONS.md#d-176): a project's tables beside the one open, its columns and rows in a
// grid. The owner adds, edits and deletes rows, makes tables and columns, renames and removes them.
import type { Result, TableInfo } from "@apx/protocol";
import { ApxError } from "@apx/protocol/client";
import {
  Button,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Icons,
  Input,
  MasterDetail,
  Menu,
  PickRow,
  Skeleton,
} from "@apx/ui";
import { useCallback, useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { NewName } from "./NewName.tsx";
import { runWhen } from "./run-view.ts";
import { changedCells, gridRows } from "./table-grid.ts";
import {
  addColumn,
  columnName,
  createTable,
  deleteRows,
  readTable,
  removeColumn,
  removeTable,
  renameColumn,
  renameTable,
  requireColumn,
  useTables,
  writeRow,
} from "./tables-data.ts";
import { tableName } from "./values.ts";
import "./tables.css";

type T = ReturnType<typeof useT>;
const columnsText = (n: number, t: T) => t(n === 1 ? "flow.tables.columnsOne" : "flow.tables.columnsN", { n });
const rowsText = (n: number, t: T) =>
  t(n === 1 ? "flow.tbl.rowsOne" : n === 0 ? "flow.tbl.empty" : "flow.tbl.rows", { n });

/** Every project's tables when no project is chosen. */
function useAllTables(on: boolean) {
  const [all, setAll] = useState<TableInfo[]>();
  useEffect(() => {
    if (!on) return;
    let live = true;
    void client.call("tables.list", {}).then(
      (r) => live && setAll(r.tables),
      () => live && setAll([]),
    );
    return () => {
      live = false;
    };
  }, [on]);
  return all;
}

export function TablesView({ projectId, table }: { projectId: string | undefined; table: string | undefined }) {
  const t = useT();
  const projects = useData((s) => s.projects);
  const own = useTables(projectId);
  const all = useAllTables(!projectId);
  const tables = projectId ? own : all;
  const open = projectId && table ? own?.find((x) => x.name === table) : undefined;
  const projectOf = (id: string) => projects.find((p) => p.id === id)?.name ?? id;
  const list = !tables ? (
    <Skeleton width="100%" height={120} />
  ) : (
    <>
      {projectId && (
        <div className="ft-list__new">
          <NewName
            label={t("flow.tbl.new")}
            field={t("flow.tbl.newName")}
            placeholder="leads"
            clean={tableName}
            create={async (name) => {
              await createTable(projectId, name);
              go.tables(projectId, name);
            }}
          />
        </div>
      )}
      {tables.length === 0 ? (
        <EmptyState variant="dashed" size="sm" icon={<Icons.Database />} title={t("flow.tables.none")}>
          {t(projectId ? "flow.tables.noneBody" : "flow.tables.pickProject")}
        </EmptyState>
      ) : (
        tables.map((x) => (
          <PickRow
            key={`${x.project}/${x.name}`}
            mono
            title={x.name}
            description={`${projectId ? "" : `${projectOf(x.project)} · `}${t("flow.tables.shape", {
              columns: columnsText(x.columns.length, t),
              rows: rowsText(x.rows, t),
            })}`}
            selected={open?.name === x.name && open.project === x.project}
            onClick={() => go.tables(x.project, x.name)}
          />
        ))
      )}
    </>
  );
  return (
    <MasterDetail
      className="ft-view"
      resizeKey="tables"
      listLabel={t("flow.tab.tables")}
      backLabel={t("flow.tab.tables")}
      onBack={() => go.tables(projectId)}
      list={list}
      detail={open && <TableDetail key={`${open.project}/${open.name}`} table={open} />}
      empty={
        <EmptyState icon={<Icons.Database />} title={t("flow.tables.pick")}>
          {t("flow.tables.pickBody")}
        </EmptyState>
      }
    />
  );
}

type Rows = Result<"tables.get">["rows"];
type Edit = { key: string; cells: string[]; isNew: boolean };
type Ask =
  | { kind: "table" }
  | { kind: "column"; column: string }
  | { kind: "renameTable" }
  | { kind: "renameColumn"; column: string };

function TableDetail({ table }: { table: TableInfo }) {
  const t = useT();
  const { project, name, columns } = table;
  const [rows, setRows] = useState<Rows>();
  const [edit, setEdit] = useState<Edit>();
  const [ask, setAsk] = useState<Ask>();
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    void readTable(project, name).then(
      (r) => setRows(r.rows),
      () => setRows([]),
    );
  }, [project, name]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a column added or removed reads the rows again
  useEffect(load, [load, columns.join("\n")]);
  const grid = rows ? gridRows(table, rows) : undefined;
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      setAsk(undefined);
      setEdit(undefined);
      load();
    } catch (e) {
      // A save that leaves a required column empty says which (DECISIONS.md#d-180).
      const empty = e instanceof ApxError ? (e.detail as { columns?: unknown } | undefined)?.columns : undefined;
      notify(
        Array.isArray(empty) && empty.length
          ? t("flow.tables.requiredMissing", { columns: empty.join(", ") })
          : t("flow.tables.failed"),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ft-detail">
      <header className="ft-detail__head">
        <div className="ft-detail__title">
          <h2>{name}</h2>
          <span>
            {t("flow.tables.shape", { columns: columnsText(columns.length, t), rows: rowsText(table.rows, t) })} ·{" "}
            {t("flow.tables.changed", { when: runWhen(table.updated_at) })}
          </span>
        </div>
        <Button
          size="sm"
          leadingIcon={<Icons.Plus size={14} />}
          disabled={!columns.length}
          onClick={() => setEdit({ key: "", cells: columns.map(() => ""), isNew: true })}
        >
          {t("flow.tables.addRow")}
        </Button>
        <Menu
          trigger={<IconButton label={t("flow.tables.more")} icon={<Icons.Ellipsis size={14} />} variant="ghost" />}
          items={[
            { label: t("flow.tables.rename"), icon: <Icons.Pencil />, onSelect: () => setAsk({ kind: "renameTable" }) },
            { type: "separator" },
            {
              label: t("flow.tables.remove"),
              icon: <Icons.Trash2 />,
              danger: true,
              onSelect: () => setAsk({ kind: "table" }),
            },
          ]}
        />
      </header>
      <NewName
        label={t("flow.tbl.newColumn")}
        field={t("flow.tbl.newColumnName")}
        placeholder="phone"
        clean={columnName}
        create={(c) => addColumn(project, name, c)}
      />
      {!grid ? (
        <Skeleton width="100%" height={120} />
      ) : !columns.length ? (
        <p className="fe-note">{t("flow.tables.noColumns")}</p>
      ) : (
        <Grid
          table={table}
          grid={grid}
          onEdit={setEdit}
          onAsk={setAsk}
          onRequire={(column, on) => void act(() => requireColumn(project, name, column, on))}
        />
      )}
      {edit && (
        <RowDialog
          table={table}
          edit={edit}
          before={grid?.find((r) => r.key === edit.key)?.cells}
          busy={busy}
          onClose={() => setEdit(undefined)}
          onSave={(key, values) => void act(() => writeRow(project, name, key, values))}
          onDelete={() => void act(() => deleteRows(project, name, [edit.key]))}
        />
      )}
      {ask && <AskDialog table={table} ask={ask} busy={busy} act={act} onClose={() => setAsk(undefined)} />}
    </div>
  );
}

/** The rows in a grid: a row's key opens it, a column's menu marks it required, renames or deletes it. */
function Grid({
  table,
  grid,
  onEdit,
  onAsk,
  onRequire,
}: {
  table: TableInfo;
  grid: ReturnType<typeof gridRows>;
  onEdit: (e: Edit) => void;
  onAsk: (a: Ask) => void;
  onRequire: (column: string, required: boolean) => void;
}) {
  const t = useT();
  const { name, columns } = table;
  const required = new Set(table.required);
  return (
    <section className="ft-grid" aria-label={name}>
      <table>
        <thead>
          <tr>
            <th scope="col">{t("flow.f.key")}</th>
            {columns.map((c) => (
              <th key={c} scope="col">
                <span className="ft-grid__col">
                  <span className="fe-mono">
                    {c}
                    {required.has(c) && (
                      <span className="ft-required" title={t("flow.tbl.required")}>
                        {" *"}
                      </span>
                    )}
                  </span>
                  <Menu
                    trigger={
                      <IconButton
                        size="sm"
                        label={t("flow.tables.columnMenu", { name: c })}
                        icon={<Icons.ChevronDown size={12} />}
                        variant="ghost"
                      />
                    }
                    items={[
                      {
                        label: t(required.has(c) ? "flow.tables.unrequire" : "flow.tables.require"),
                        icon: <Icons.Check />,
                        onSelect: () => onRequire(c, !required.has(c)),
                      },
                      {
                        label: t("flow.tables.renameColumn"),
                        icon: <Icons.Pencil />,
                        onSelect: () => onAsk({ kind: "renameColumn", column: c }),
                      },
                      { type: "separator" },
                      {
                        label: t("flow.tables.removeColumn"),
                        icon: <Icons.Trash2 />,
                        danger: true,
                        onSelect: () => onAsk({ kind: "column", column: c }),
                      },
                    ]}
                  />
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.length === 0 && (
            <tr>
              <td colSpan={columns.length + 1} className="ft-grid__none">
                {t("flow.tables.noRows")}
              </td>
            </tr>
          )}
          {grid.map((r) => (
            <tr key={r.key}>
              <th scope="row">
                <button
                  type="button"
                  className="ft-grid__key fe-mono"
                  aria-label={t("flow.tables.editRow", { key: r.key })}
                  onClick={() => onEdit({ key: r.key, cells: r.cells, isNew: false })}
                >
                  {r.key}
                </button>
              </th>
              {r.cells.map((c, i) => (
                <td key={columns[i]} title={c}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Renaming asks for the new name; deleting a table or a column asks first. */
function AskDialog({
  table,
  ask,
  busy,
  act,
  onClose,
}: {
  table: TableInfo;
  ask: Ask;
  busy: boolean;
  act: (fn: () => Promise<unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const { project, name } = table;
  if (ask.kind === "renameTable" || ask.kind === "renameColumn")
    return (
      <RenameDialog
        was={ask.kind === "renameTable" ? name : ask.column}
        clean={ask.kind === "renameTable" ? tableName : columnName}
        title={t(ask.kind === "renameTable" ? "flow.tables.rename" : "flow.tables.renameColumn")}
        note={t("flow.tables.renameNote")}
        busy={busy}
        onClose={onClose}
        onSave={(to) =>
          void act(async () => {
            if (ask.kind === "renameTable") {
              await renameTable(project, name, to);
              go.tables(project, to);
            } else await renameColumn(project, name, ask.column, to);
          })
        }
      />
    );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={
        ask.kind === "table"
          ? t("flow.tables.removeTitle", { name })
          : t("flow.tables.removeColumnTitle", { name: ask.column })
      }
      description={
        ask.kind === "table"
          ? t("flow.tables.removeBody", { rows: rowsText(table.rows, t) })
          : t("flow.tables.removeColumnBody")
      }
      closeLabel={t("common.close")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                if (ask.kind === "table") {
                  await removeTable(project, name);
                  go.tables(project);
                } else await removeColumn(project, name, ask.column);
              })
            }
          >
            {t("flow.tables.delete")}
          </Button>
        </>
      }
    />
  );
}

function RowDialog(props: {
  table: TableInfo;
  edit: Edit;
  before: string[] | undefined;
  busy: boolean;
  onClose: () => void;
  onSave: (key: string, values: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  const t = useT();
  const { table, edit } = props;
  const [key, setKey] = useState(edit.key);
  const [cells, setCells] = useState(edit.cells);
  const [deleting, setDeleting] = useState(false);
  const values = changedCells(table.columns, edit.isNew ? undefined : props.before, cells);
  const required = new Set(table.required);
  const missing = table.columns.some((c, i) => required.has(c) && !(cells[i] ?? "").trim());
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && props.onClose()}
      title={edit.isNew ? t("flow.tables.addRow") : t("flow.tables.editRowTitle")}
      closeLabel={t("common.close")}
      footer={
        deleting ? (
          <>
            <span className="ft-dialog__ask">{t("flow.tables.deleteRowAsk")}</span>
            <Button variant="secondary" onClick={() => setDeleting(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" disabled={props.busy} onClick={props.onDelete}>
              {t("flow.tables.delete")}
            </Button>
          </>
        ) : (
          <>
            {!edit.isNew && (
              <Button variant="ghost" className="ft-dialog__delete" onClick={() => setDeleting(true)}>
                {t("flow.tables.deleteRow")}
              </Button>
            )}
            <Button variant="secondary" onClick={props.onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={props.busy || !key.trim() || missing || (!edit.isNew && !Object.keys(values).length)}
              onClick={() => props.onSave(key.trim(), values)}
            >
              {t("flow.tables.saveRow")}
            </Button>
          </>
        )
      }
    >
      <div className="ft-dialog">
        <Field label={t("flow.f.key")} hint={edit.isNew ? t("flow.tables.keyHint") : undefined}>
          {(id) => (
            <Input
              id={id}
              className="fe-mono"
              value={key}
              disabled={!edit.isNew}
              maxLength={128}
              autoFocus={edit.isNew}
              onChange={(e) => setKey(e.target.value)}
            />
          )}
        </Field>
        {table.columns.map((c, i) => (
          <Field
            key={c}
            label={required.has(c) ? `${c} *` : c}
            hint={required.has(c) ? t("flow.tbl.required") : undefined}
          >
            {(id) => (
              <Input
                id={id}
                value={cells[i] ?? ""}
                onChange={(e) => setCells(cells.map((v, j) => (j === i ? e.target.value : v)))}
              />
            )}
          </Field>
        ))}
        <p className="fe-note">{t("flow.tables.cellHint")}</p>
      </div>
    </Dialog>
  );
}

function RenameDialog(props: {
  was: string;
  clean: (typed: string) => string;
  title: string;
  note: string;
  busy: boolean;
  onClose: () => void;
  onSave: (to: string) => void;
}) {
  const t = useT();
  const [to, setTo] = useState(props.was);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && props.onClose()}
      title={props.title}
      description={props.note}
      closeLabel={t("common.close")}
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={props.busy || !to || to === props.was} onClick={() => props.onSave(to)}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <Field label={t("flow.tables.newName")}>
        {(id) => (
          <Input
            id={id}
            className="fe-mono"
            autoFocus
            value={to}
            onChange={(e) => setTo(props.clean(e.target.value))}
          />
        )}
      </Field>
    </Dialog>
  );
}
