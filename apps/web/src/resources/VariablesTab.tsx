import { Badge, Button, ContextMenu, Dialog, EmptyState, IconButton, Icons } from "@apx/ui";
import { useEffect, useRef, useState } from "react";
import { client } from "../data/client.ts";
import { projectName } from "../data/identity.ts";
import { notify } from "../data/notices.ts";
import { type SecretInfo, setSecret } from "../data/resources.ts";
import { useData } from "../data/state.ts";
import { type MessageKey, usePack, useT } from "../i18n/index.ts";
import { useNav } from "../shell/nav.ts";
import type { TabProps, VarKind } from "./ResourcesView.tsx";
import { SignInSitesDialog, siteLabel } from "./SignInSites.tsx";
import { VariableDialog } from "./VariableDialog.tsx";

type Row = {
  name: string;
  /** A project's own value (absent: the global one). */
  project?: string | undefined;
  hint?: string | undefined;
  stored: boolean;
  usedIn: string[];
  /** Where agents may sign in with it (DECISIONS.md#d-193). */
  sites: SecretInfo["sites"];
  /** APX keeps it for itself: it is changed where that was connected, not here. */
  system?: boolean | undefined;
  lastUsed?: SecretInfo["last_used"];
};
const keyOf = (r: Pick<Row, "name" | "project">) => `${r.project ?? ""}/${r.name}`;

/** What each kind of list says above it, and when it is empty. */
const KIND_NOTE = {
  own: "res.varsNote",
  login: "res.varKind.loginNote",
  system: "res.varKind.systemNote",
} as const satisfies Record<VarKind, MessageKey>;
/** Where APX uses one it keeps for itself ("provider:openai"), in words. */
const OWNER = {
  provider: "res.varOwner.provider",
  channel: "res.varOwner.channel",
  service: "res.varOwner.service",
  integration: "res.varOwner.integration",
  extension: "res.varOwner.extension",
  artifact: "res.varOwner.artifact",
} as const satisfies Record<string, MessageKey>;
function whereLabel(t: ReturnType<typeof useT>, where: string): string {
  if (where === "public") return t("res.varOwner.public");
  const [kind = "", name = ""] = where.split(/:(.*)/);
  return kind in OWNER ? t(OWNER[kind as keyof typeof OWNER], { name }) : where;
}
const usedLabel = (t: ReturnType<typeof useT>, r: Row) =>
  (r.system ? r.usedIn.map((w) => whereLabel(t, w)) : r.usedIn).join(", ");

const KIND_EMPTY = {
  own: "res.noVariables",
  login: "res.noLoginVariables",
  system: "res.noSystemVariables",
} as const satisfies Record<VarKind, MessageKey>;

/**
 * Variables: the stored secrets MCP servers, providers and channels name as `secret://NAME`. Values never come back
 * to the panel; long ones show their last four characters. A name a server uses but nobody stored shows "No value".
 */
export function VariablesTab(props: TabProps) {
  return usePack("signIn") ? <VariablesTabBody {...props} /> : null;
}

function VariablesTabBody({ projectId, query, scope, adding, setAdding, res, ownOnly, varKind = "own" }: TabProps) {
  const t = useT();
  const projects = useData((s) => s.projects);
  const [editing, setEditing] = useState<Row>();
  const [removing, setRemoving] = useState<Row>();
  const [signing, setSigning] = useState<Row>();
  // A link from where a variable is used picks its row.
  const variable = useNav((s) => s.variable);
  const variableIn = useNav((s) => s.variableIn);
  const wanted = variable ? keyOf({ name: variable, project: variableIn }) : undefined;
  const pickedRow = useRef<HTMLTableRowElement>(null);
  // In a project: the global values and this project's own; globally: every value, each with its project.
  const stored: Row[] = (res.data.secrets ?? [])
    .filter((s) => !projectId || s.project_id === projectId || (!s.project_id && !ownOnly))
    // The global screen's scope chips: every value, only the global ones, or one project's own.
    .filter((s) => projectId || scope === "all" || (scope === "global" ? !s.project_id : s.project_id === scope))
    .map((s) => ({
      name: s.name,
      project: s.project_id,
      hint: s.hint,
      stored: true,
      usedIn: s.used_in,
      sites: s.sites,
      lastUsed: s.last_used,
      system: s.system,
    }));
  const own = new Set(stored.filter((r) => r.project).map((r) => r.name));
  const missing = new Map<string, string[]>();
  // Only the project's own: a name only its own servers ask for.
  for (const srv of (res.data.servers ?? []).filter((x) => !ownOnly || x.project_id === projectId))
    for (const v of srv.vars)
      if (!v.set && !stored.some((r) => r.name === v.name))
        missing.set(v.name, [...(missing.get(v.name) ?? []), `mcp:${srv.name}`]);
  const empty: Row[] = [...missing].map(([name, usedIn]) => ({ name, stored: false, usedIn, sites: [] }));
  const rows: Row[] = [...stored, ...empty]
    .filter((r) => (varKind === "system" ? r.system : !r.system && (varKind === "own" || r.sites.length > 0)))
    .filter((r) => !query || `${r.name} ${r.usedIn.join(" ")}`.toLowerCase().includes(query))
    .sort((a, b) => a.name.localeCompare(b.name) || Number(Boolean(a.project)) - Number(Boolean(b.project)));
  // The one in that scope, else the first of that name (a link that cannot tell which one a server uses).
  const match = rows.find((r) => keyOf(r) === wanted) ?? rows.find((r) => r.name === variable);
  const picked = match && keyOf(match);
  useEffect(() => {
    if (picked) pickedRow.current?.scrollIntoView({ block: "center" });
  }, [picked]);
  const reload = async () => {
    await res.loadSecrets();
    await res.loadServers();
  };

  return (
    <div className="resvars">
      <p className="resvars__note">{t(KIND_NOTE[varKind])}</p>
      {res.data.secrets && !rows.length ? (
        <EmptyState variant="dashed" icon={<Icons.KeyRound />}>
          {query ? t("res.noMatch") : t(KIND_EMPTY[varKind])}
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
              <ContextMenu
                key={keyOf(r)}
                render={
                  <tr
                    ref={keyOf(r) === picked ? pickedRow : undefined}
                    aria-selected={keyOf(r) === picked || undefined}
                    className={
                      [
                        projectId && !r.project && own.has(r.name) ? "is-shadowed" : "",
                        keyOf(r) === picked ? "is-picked" : "",
                      ]
                        .filter(Boolean)
                        .join(" ") || undefined
                    }
                  />
                }
                items={[
                  ...(r.system
                    ? []
                    : [
                        {
                          label: r.stored ? t("res.edit") : t("res.varSetShort"),
                          icon: <Icons.Pencil size={14} />,
                          onSelect: () => setEditing(r),
                        },
                      ]),
                  {
                    label: t("res.copyName"),
                    icon: <Icons.Copy size={14} />,
                    onSelect: () => void navigator.clipboard.writeText(r.name).catch(() => {}),
                  },
                  ...(r.stored
                    ? [
                        ...(r.system
                          ? []
                          : [
                              {
                                label: t("res.signIn.menu"),
                                icon: <Icons.LogIn size={14} />,
                                onSelect: () => setSigning(r),
                              },
                            ]),
                        { type: "separator" as const },
                        {
                          label: t("res.remove"),
                          icon: <Icons.Trash2 size={14} />,
                          danger: true,
                          onSelect: () => setRemoving(r),
                        },
                      ]
                    : []),
                ]}
              >
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
                <td className="resvars__used">
                  {usedLabel(t, r) || (r.sites.length ? "" : "—")}
                  {r.sites.length > 0 && (
                    <span className="resvars__sites">
                      {r.sites.some((x) => x.origin === "*") ? (
                        <Badge tone="warning">{t("res.signIn.badgeAny")}</Badge>
                      ) : (
                        <Badge>
                          {r.sites.length === 1
                            ? t("res.signIn.badge", { sites: siteLabel(r.sites[0]?.origin ?? "") })
                            : t("res.signIn.badgeCount", { n: r.sites.length })}
                        </Badge>
                      )}
                    </span>
                  )}
                </td>
                <td className="resvars__actions">
                  {!r.system && (
                    <IconButton
                      size="sm"
                      label={r.stored ? t("res.varEdit", { name: r.name }) : t("res.varSetValue", { name: r.name })}
                      icon={<Icons.Pencil size={14} />}
                      onClick={() => setEditing(r)}
                    />
                  )}
                  {r.stored && !r.system && (
                    <IconButton
                      size="sm"
                      label={t("res.signIn.title", { name: r.name })}
                      icon={<Icons.LogIn size={14} />}
                      onClick={() => setSigning(r)}
                    />
                  )}
                  {r.stored && (
                    <IconButton
                      size="sm"
                      label={t("res.varRemove", { name: r.name })}
                      icon={<Icons.Trash2 size={14} />}
                      onClick={() => setRemoving(r)}
                    />
                  )}
                </td>
              </ContextMenu>
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
      {signing && (
        <SignInSitesDialog
          name={signing.name}
          project={signing.project}
          sites={signing.sites}
          lastUsed={signing.lastUsed}
          onClose={() => setSigning(undefined)}
          onSaved={async () => {
            setSigning(undefined);
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
            {removing.system
              ? t("res.varRemoveSystem", { where: usedLabel(t, removing) })
              : removing.usedIn.length
                ? t("res.varRemoveUsed", { where: removing.usedIn.join(", ") })
                : t("res.varRemoveBody")}
          </p>
        </Dialog>
      )}
    </div>
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
