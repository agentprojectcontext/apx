import { Button, Dialog, Input, Select } from "@apx/ui";
import { useState } from "react";
import { projectName } from "../data/identity.ts";
import { moveSecret, setSecret } from "../data/resources.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";

const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;
const GLOBAL = "global";

/** A name as the owner types it, written as an env name: upper case, a space or dash becomes "_" ("github token" → "GITHUB_TOKEN"). */
export const toVarName = (typed: string) =>
  typed
    .toUpperCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^A-Z0-9_.]/g, "")
    .slice(0, 64);

export type VariableRow = {
  name: string;
  /** A project's own value (absent: the global one). */
  project?: string | undefined;
  stored: boolean;
  usedIn: string[];
};

/**
 * A new variable, or one being edited: where it is available (every project or one of them) and a new value. Editing
 * a stored one may move it to another project without typing it again; an empty value keeps the one it has.
 */
export function VariableDialog(props: {
  row: VariableRow | undefined;
  projectId: string | undefined;
  onClose(): void;
  onSaved(name: string): void;
}) {
  const { row, onClose, onSaved } = props;
  const t = useT();
  const projects = useData((s) => s.projects);
  const [name, setName] = useState(row?.name ?? "");
  // A new value from a project's view is that project's own unless the owner says otherwise.
  const [where, setWhere] = useState(row ? (row.project ?? GLOBAL) : (props.projectId ?? GLOBAL));
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const target = where === GLOBAL ? undefined : where;
  const keeps = Boolean(row?.stored);
  const moving = keeps && target !== row?.project;
  const valid = NAME.test(name) && (value.length > 0 || (keeps && moving));
  const save = async () => {
    setBusy(true);
    let ok = true;
    if (moving && row) ok = Boolean(await moveSecret(row.name, row.project, target));
    if (ok && value) ok = Boolean(await setSecret(name, value, target));
    setBusy(false);
    if (ok) onSaved(name);
  };
  const choices = projects.filter((p) => (p.path && p.registered !== false) || p.id === row?.project);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={row ? t("res.varEdit", { name: row.name }) : t("res.newVariable")}
      description={t("res.varDialogLead")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!valid} loading={busy} onClick={() => void save()}>
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
            placeholder="GITHUB_TOKEN"
            onChange={(e) => setName(toVarName(e.currentTarget.value))}
          />
        </div>
        <div className="pform__field">
          <span className="pform__label">{t("res.varWhere")}</span>
          <Select
            label={t("res.varWhere")}
            value={where}
            onValueChange={(next) => next && setWhere(next)}
            options={[
              { value: GLOBAL, label: t("res.varEverywhere") },
              ...choices.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
          {moving && row && row.usedIn.length > 0 && (
            <p role="status" className="resd__note">
              {t("res.varMoveUsed", {
                where: row.usedIn.join(", "),
                place: target ? projectName(projects, target) : t("res.varEverywhere"),
              })}
            </p>
          )}
        </div>
        <div className="pform__field">
          <span className="pform__label">{t("res.varValue")}</span>
          <Input
            aria-label={t("res.varValue")}
            type="password"
            autoComplete="off"
            value={value}
            placeholder={keeps ? t("res.varKeepValue") : undefined}
            onChange={(e) => setValue(e.currentTarget.value)}
          />
        </div>
      </div>
    </Dialog>
  );
}
