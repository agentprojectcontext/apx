import { Badge, Button, Dialog, EmptyState, IconButton, Icons, Input } from "@apx/ui";
import { useState } from "react";
import { setSecret } from "../data/resources.ts";
import { useT } from "../i18n/index.ts";
import type { TabProps } from "./ResourcesView.tsx";

type Row = { name: string; hint?: string | undefined; stored: boolean; usedIn: string[] };
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;

/**
 * Variables: the stored secrets MCP servers, providers and channels name as `secret://NAME`. Values never come back
 * to the panel; long ones show their last four characters. A name a server uses but nobody stored shows "No value".
 */
export function VariablesTab({ query, adding, setAdding, res }: TabProps) {
  const t = useT();
  const [editing, setEditing] = useState<Row>();
  const [removing, setRemoving] = useState<Row>();
  const stored: Row[] = (res.data.secrets ?? []).map((s) => ({
    name: s.name,
    hint: s.hint,
    stored: true,
    usedIn: s.used_in,
  }));
  const missing = new Map<string, string[]>();
  for (const srv of res.data.servers ?? [])
    for (const v of srv.vars)
      if (!v.set && !stored.some((r) => r.name === v.name))
        missing.set(v.name, [...(missing.get(v.name) ?? []), `mcp:${srv.name}`]);
  const rows: Row[] = [...stored, ...[...missing].map(([name, usedIn]) => ({ name, stored: false, usedIn }))]
    .filter((r) => !query || `${r.name} ${r.usedIn.join(" ")}`.toLowerCase().includes(query))
    .sort((a, b) => a.name.localeCompare(b.name));
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
              <tr key={r.name}>
                <td className="resvars__name">{r.name}</td>
                <td>
                  <Badge>{t("res.scope.global")}</Badge>
                </td>
                <td className="resvars__value">
                  {r.stored ? `••••••••${r.hint ?? ""}` : <span className="resvars__missing">{t("res.noValue")}</span>}
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
                  const name = removing.name;
                  setRemoving(undefined);
                  void setSecret(name, null).then(reload);
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
function VariableDialog({ row, onClose, onSaved }: { row: Row | undefined; onClose(): void; onSaved(): void }) {
  const t = useT();
  const [name, setName] = useState(row?.name ?? "");
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
              void setSecret(name, value).then((r) => {
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
