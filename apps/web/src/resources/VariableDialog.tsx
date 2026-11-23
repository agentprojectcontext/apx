import type { SecretInfo } from "@apx/protocol";
import { Button, Dialog, Input, Select, TagInput } from "@apx/ui";
import { useState } from "react";
import { projectName } from "../data/identity.ts";
import { moveSecret, saveSecret, setSecretSites } from "../data/resources.ts";
import { useData } from "../data/state.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { siteLabel, siteOf } from "./SignInSites.tsx";

const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;
const GLOBAL = "global";
/** A plain variable: an API key, a token, anything that is not typed into a sign-in field. */
const PLAIN = "plain";

type Field = NonNullable<SecretInfo["field"]>;
type Kind = Field | typeof PLAIN;
const KINDS = [
  [PLAIN, "res.field.plain"],
  ["login", "res.field.login"],
  ["password", "res.field.password"],
  ["username", "res.field.username"],
  ["otp", "res.field.otp"],
] as const satisfies ReadonlyArray<readonly [Kind, MessageKey]>;

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
  /** What it is for, when the owner said or its sign-in sites say. */
  field?: Field | undefined;
  sites?: SecretInfo["sites"] | undefined;
};

/**
 * A new variable, or one being edited: what it is (a plain value, or something agents type into a sign-in field), where
 * it is available (every project or one of them), its value and, for a sign-in, the sites it is for. A username and
 * password together is one variable with two fields. Editing may move it to another project without typing it again;
 * an empty field keeps what it has.
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
  const [kind, setKind] = useState<Kind>(row?.field ?? PLAIN);
  const [value, setValue] = useState("");
  const [username, setUsername] = useState("");
  const initialSites = [...new Set((row?.sites ?? []).filter((s) => s.origin !== "*").map((s) => siteLabel(s.origin)))];
  const anySite = Boolean(row?.sites?.some((s) => s.origin === "*"));
  const [sites, setSites] = useState(initialSites);
  const [busy, setBusy] = useState(false);
  const target = where === GLOBAL ? undefined : where;
  const keeps = Boolean(row?.stored);
  const moving = keeps && target !== row?.project;
  const login = kind === "login";
  // A sign-in it was not before needs its password; one it already was keeps what is left empty.
  const typed = login ? value.length > 0 || username.length > 0 : value.length > 0;
  const kindChanged = keeps && kind !== (row?.field ?? PLAIN);
  const needsValue = !keeps || (login && row?.field !== "login");
  const wrongSite = sites.find((s) => !siteOf(s));
  const sitesChanged = sites.join("\n") !== initialSites.join("\n");
  const valid =
    NAME.test(name) &&
    !wrongSite &&
    (needsValue ? (login ? value.length > 0 : typed) : typed || moving || kindChanged || sitesChanged);
  const save = async () => {
    setBusy(true);
    let ok = true;
    const at = target ? { project: target } : {};
    if (moving && row) ok = Boolean(await moveSecret(row.name, row.project, target));
    if (ok && login && typed)
      ok = Boolean(
        await saveSecret({
          name,
          login: { ...(username || !keeps ? { username } : {}), ...(value ? { password: value } : {}) },
          ...at,
        }),
      );
    else if (ok && typed) ok = Boolean(await saveSecret({ name, value, field: kind === PLAIN ? null : kind, ...at }));
    else if (ok && kindChanged) ok = Boolean(await saveSecret({ name, field: kind === PLAIN ? null : kind, ...at }));
    if (ok && kind !== PLAIN && sitesChanged && !anySite)
      ok = Boolean(
        await setSecretSites(
          name,
          sites.map((s) => ({ origin: siteOf(s) as string, kind: kind === "login" ? "password" : kind })),
          target,
        ),
      );
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
            placeholder={login ? "ACME_LOGIN" : "GITHUB_TOKEN"}
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
          <span className="pform__label">{t("res.varType")}</span>
          <Select
            label={t("res.varType")}
            value={kind}
            onValueChange={(next) => next && setKind(next as Kind)}
            options={KINDS.map(([value, label]) => ({ value, label: t(label) }))}
          />
        </div>
        {login && (
          <div className="pform__field">
            <span className="pform__label">{t("res.field.username")}</span>
            <Input
              aria-label={t("res.field.username")}
              autoComplete="off"
              value={username}
              placeholder={keeps && row?.field === "login" ? t("res.varKeepValue") : "user@example.com"}
              onChange={(e) => setUsername(e.currentTarget.value)}
            />
          </div>
        )}
        <div className="pform__field">
          <span className="pform__label">{login ? t("res.field.password") : t("res.varValue")}</span>
          <Input
            aria-label={login ? t("res.field.password") : t("res.varValue")}
            type="password"
            autoComplete="off"
            value={value}
            placeholder={keeps && !needsValue ? t("res.varKeepValue") : undefined}
            onChange={(e) => setValue(e.currentTarget.value)}
          />
          {kind === "otp" && <p className="resd__note">{t("res.signIn.otpHint")}</p>}
        </div>
        {kind !== PLAIN && !anySite && (
          <div className="pform__field">
            <span className="pform__label">{t("res.signIn.sites")}</span>
            <TagInput
              label={t("res.signIn.sites")}
              value={sites}
              onValueChange={setSites}
              placeholder="app.acme.com"
              max={12}
            />
            <p className="resd__note" role={wrongSite ? "alert" : undefined}>
              {wrongSite ? t("res.signIn.wrongSite", { site: wrongSite }) : t("res.varSitesHint")}
            </p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
