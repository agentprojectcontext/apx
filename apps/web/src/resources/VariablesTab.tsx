import { Badge, Button, Checkbox, Dialog, EmptyState, IconButton, Icons, Input } from "@apx/ui";
import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { projectName } from "../data/identity.ts";
import { notify } from "../data/notices.ts";
import { setSecret } from "../data/resources.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import type { TabProps } from "./ResourcesView.tsx";

type Row = {
  name: string;
  /** A project's own value (absent: the global one). */
  project?: string | undefined;
  hint?: string | undefined;
  stored: boolean;
  usedIn: string[];
};
const keyOf = (r: Row) => `${r.project ?? ""}/${r.name}`;
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;

/**
 * Variables: the stored secrets MCP servers, providers and channels name as `secret://NAME`. Values never come back
 * to the panel; long ones show their last four characters. A name a server uses but nobody stored shows "No value".
 */
export function VariablesTab({ projectId, query, scope, adding, setAdding, res }: TabProps) {
  const t = useT();
  const projects = useData((s) => s.projects);
  const [editing, setEditing] = useState<Row>();
  const [removing, setRemoving] = useState<Row>();
  // In a project: the global values and this project's own; globally: every value, each with its project.
  const stored: Row[] = (res.data.secrets ?? [])
    .filter((s) => !projectId || !s.project_id || s.project_id === projectId)
    // The global screen's scope chips: every value, only the global ones, or one project's own.
    .filter((s) => projectId || scope === "all" || (scope === "global" ? !s.project_id : s.project_id === scope))
    .map((s) => ({ name: s.name, project: s.project_id, hint: s.hint, stored: true, usedIn: s.used_in }));
  const own = new Set(stored.filter((r) => r.project).map((r) => r.name));
  const missing = new Map<string, string[]>();
  for (const srv of res.data.servers ?? [])
    for (const v of srv.vars)
      if (!v.set && !stored.some((r) => r.name === v.name))
        missing.set(v.name, [...(missing.get(v.name) ?? []), `mcp:${srv.name}`]);
  const empty: Row[] = [...missing].map(([name, usedIn]) => ({ name, stored: false, usedIn }));
  const rows: Row[] = [...stored, ...empty]
    .filter((r) => !query || `${r.name} ${r.usedIn.join(" ")}`.toLowerCase().includes(query))
    .sort((a, b) => a.name.localeCompare(b.name) || Number(Boolean(a.project)) - Number(Boolean(b.project)));
  const reload = async () => {
    await res.loadSecrets();
    await res.loadServers();
  };

  return (
    <div className="resvars">
      <p className="resvars__note">{t("res.varsNote")}</p>
      {res.data.secrets && !rows.length ? (
        <EmptyState variant="dashed" icon={<Icons.KeyRound />}>
          {query ? t("res.noMatch") : t("res.noVariables")}
        </EmptyState>
      ) : (
        <table className="resvars__table">
          <thead>
            <tr>
              <th>{t("res.varName")}</th>
              <th>{t("res.varScope")}</th>
              <th>{t("res.varValue")}</th>
              <th>{t("res.varUsedIn")}</th>
              <th aria-label={t("res.actions")} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={keyOf(r)} className={projectId && !r.project && own.has(r.name) ? "is-shadowed" : undefined}>
                <td className="resvars__name">{r.name}</td>
                <td>
                  <span className="resvars__scope">
                    <Badge>{r.project ? projectName(projects, r.project) : t("res.scope.global")}</Badge>
                    {r.project && stored.some((g) => g.name === r.name && !g.project) && (
                      <Badge tone="info">{t("res.varOverrides")}</Badge>
                    )}
                    {projectId && !r.project && own.has(r.name) && <Badge>{t("res.varOverridden")}</Badge>}
                  </span>
                </td>
                <td className="resvars__value">
                  {r.stored ? <Reveal row={r} /> : <span className="resvars__missing">{t("res.noValue")}</span>}
                </td>
                <td className="resvars__used">{r.usedIn.join(", ") || "—"}</td>
                <td className="resvars__actions">
                  <IconButton
                    size="sm"
                    label={r.stored ? t("res.varReplace", { name: r.name }) : t("res.varSetValue", { name: r.name })}
                    icon={<Icons.Pencil size={14} />}
                    onClick={() => setEditing(r)}
                  />
                  {r.stored && (
                    <IconButton
                      size="sm"
                      label={t("res.varRemove", { name: r.name })}
                      icon={<Icons.Trash2 size={14} />}
                      onClick={() => setRemoving(r)}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {(adding || editing) && (
        <VariableDialog
          row={editing}
          projectId={projectId}
          onClose={() => {
            setAdding(false);
            setEditing(undefined);
          }}
          onSaved={async () => {
            setAdding(false);
            setEditing(undefined);
            await reload();
          }}
        />
      )}
      {removing && (
        <Dialog
          open
          onOpenChange={(o) => !o && setRemoving(undefined)}
          title={t("res.varRemoveTitle", { name: removing.name })}
          footer={
            <>
              <Button variant="secondary" onClick={() => setRemoving(undefined)}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  const { name } = removing;
                  setRemoving(undefined);
                  void setSecret(name, null, removing.project).then(reload);
                }}
              >
                {t("res.remove")}
              </Button>
            </>
          }
        >
          <p className="resd__note">
            {removing.usedIn.length
              ? t("res.varRemoveUsed", { where: removing.usedIn.join(", ") })
              : t("res.varRemoveBody")}
          </p>
        </Dialog>
      )}
    </div>
  );
}

/** New variable, or a new value for one: the old value is replaced, never shown. */
function VariableDialog(props: {
  row: Row | undefined;
  projectId: string | undefined;
  onClose(): void;
  onSaved(): void;
}) {
  const { row, onClose, onSaved } = props;
  const t = useT();
  const projects = useData((s) => s.projects);
  const [name, setName] = useState(row?.name ?? "");
  // A new value from a project's view is that project's own unless the owner says otherwise.
  const [onlyHere, setOnlyHere] = useState(row ? Boolean(row.project) : Boolean(props.projectId));
  const project = row ? row.project : onlyHere ? props.projectId : undefined;
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = NAME.test(name) && value.length > 0;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={row ? t("res.varReplace", { name: row.name }) : t("res.newVariable")}
      description={t("res.varDialogLead")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!valid}
            loading={busy}
            onClick={() => {
              setBusy(true);
              void setSecret(name, value, project).then((r) => {
                setBusy(false);
                if (r) onSaved();
              });
            }}
          >
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="pform">
        <div className="pform__field">
          <span className="pform__label">{t("res.varName")}</span>
          <Input
            aria-label={t("res.varName")}
            value={name}
            disabled={Boolean(row)}
            placeholder="github-token"
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <span className="pform__hint">{t("res.varNameHint")}</span>
        </div>
        {!row && props.projectId && (
          <Checkbox
            checked={onlyHere}
            onCheckedChange={setOnlyHere}
            label={t("res.varOnlyHere", { project: projectName(projects, props.projectId) })}
            description={t("res.varOnlyHereHint")}
          />
        )}
        <div className="pform__field">
          <span className="pform__label">{t("res.varValue")}</span>
          <Input
            aria-label={t("res.varValue")}
            type="password"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.currentTarget.value)}
          />
        </div>
      </div>
    </Dialog>
  );
}

/** How long a value stays shown after the eye is pressed. */
const SHOWN_MS = 20_000;

/** A stored value: hidden (its last four characters) until the eye shows it for a moment. */
function Reveal({ row }: { row: Row }) {
  const t = useT();
  const [value, setValue] = useState<string>();
  useEffect(() => {
    if (value === undefined) return;
    const hide = setTimeout(() => setValue(undefined), SHOWN_MS);
    return () => clearTimeout(hide);
  }, [value]);
  const toggle = async () => {
    if (value !== undefined) return setValue(undefined);
    try {
      const r = await client.call("secrets.reveal", {
        name: row.name,
        ...(row.project ? { project: row.project } : {}),
      });
      setValue(r.value);
    } catch (e) {
      notify(t("error.load", { error: e instanceof Error ? e.message : String(e) }));
    }
  };
  return (
    <span className="resvars__reveal">
      <span className={value !== undefined ? "resvars__shown" : undefined}>{value ?? `••••••••${row.hint ?? ""}`}</span>
      <IconButton
        size="sm"
        label={value !== undefined ? t("res.varHide", { name: row.name }) : t("res.varShow", { name: row.name })}
        icon={value !== undefined ? <Icons.EyeOff size={13} /> : <Icons.Eye size={13} />}
        onClick={() => void toggle()}
      />
    </span>
  );
}
