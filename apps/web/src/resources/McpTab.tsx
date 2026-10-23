import type { McpServerStatus } from "@apx/protocol";
import { Button, ContextMenu, Dialog, EmptyState, Icons, MasterDetail, type MenuEntry, PickRow, Tag } from "@apx/ui";
import { useState } from "react";
import { projectName } from "../data/identity.ts";
import { setMcp, setMcpToolMode, toggleMcp, trustMcp } from "../data/resources.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { mcpDot, STATUS_KEY } from "./labels.ts";
import { McpDetail } from "./McpDetail.tsx";
import { McpDialog } from "./McpDialog.tsx";
import type { TabProps } from "./ResourcesView.tsx";
import { ScopedGroups, useInheritance } from "./ScopedGroups.tsx";

const keyOf = (s: McpServerStatus) => `${s.scope}:${s.project_id ?? ""}:${s.name}`;
/** Every project gets it (an owner's server limited to one project belongs to that project). */
const isGlobal = (s: McpServerStatus) => s.scope === "global" && !s.only;

/** MCP servers: inside a project its own and the inherited global ones (each can be turned off here). */
export function McpTab({ projectId, query, scope, adding, setAdding, res, ownOnly }: TabProps) {
  const t = useT();
  const projects = useData((s) => s.projects);
  const [picked, setPicked] = useState<string>();
  const [editing, setEditing] = useState<McpServerStatus>();
  const [removing, setRemoving] = useState<McpServerStatus>();
  const [testRequest, setTestRequest] = useState(0);
  const [permissionRequest, setPermissionRequest] = useState(0);
  const [permissionServer, setPermissionServer] = useState<string>();
  const [toolReload, setToolReload] = useState(0);
  const [permissionsBusy, setPermissionsBusy] = useState(false);
  const all = res.data.servers;
  const shown = (all ?? []).filter(
    (s) =>
      (!query || `${s.name} ${s.target} ${s.tool_names.join(" ")}`.toLowerCase().includes(query)) &&
      (projectId ? s.scope === "global" || s.project_id === projectId : true) &&
      (projectId || scope === "all" || (scope === "global" ? isGlobal(s) : s.project_id === scope)),
  );
  const groups = projectId
    ? [
        {
          title: t("res.group.own", { name: projectName(projects, projectId) }),
          items: shown.filter((s) => !isGlobal(s)),
        },
        { title: t("res.group.inherited"), items: shown.filter(isGlobal) },
      ]
    : [
        { title: t("res.scope.global"), items: shown.filter(isGlobal) },
        ...projects
          .filter((p) => shown.some((s) => s.project_id === p.id))
          .map((p) => ({ title: p.name, items: shown.filter((s) => s.project_id === p.id) })),
      ];
  const current = (all ?? []).find((s) => keyOf(s) === picked);
  const inherit = useInheritance(projectId, "mcp", res.loadServers);
  const changed = () => res.loadServers();
  const setPermissions = async (s: McpServerStatus, mode: "ask" | "all") => {
    setPermissionsBusy(true);
    try {
      await setMcpToolMode(s, mode, s.scope === "project" ? s.project_id : (projectId ?? s.project_id));
      await changed();
      setToolReload((n) => n + 1);
      if (keyOf(s) === picked) setPermissionRequest(0);
    } finally {
      setPermissionsBusy(false);
    }
  };
  /** What a right-click on a server offers: the same actions as its detail, without opening it first. */
  const actions = (s: McpServerStatus): MenuEntry[] => {
    const inherited = Boolean(projectId) && isGlobal(s);
    return [
      { label: t("res.open"), icon: <Icons.PanelRight size={14} />, onSelect: () => setPicked(keyOf(s)) },
      ...(s.definition
        ? [{ label: t("res.edit"), icon: <Icons.Pencil size={14} />, onSelect: () => setEditing(s) }]
        : []),
      {
        label: t("res.test"),
        icon: <Icons.FlaskConical size={14} />,
        disabled: s.status === "needs-approval" || s.status === "needs-sign-in",
        onSelect: () => {
          setPicked(keyOf(s));
          setTestRequest((n) => n + 1);
        },
      },
      {
        type: "submenu",
        label: t("res.toolsMode"),
        icon: <Icons.Shield size={14} />,
        disabled: permissionsBusy || !s.trusted || !s.enabled || s.off_here,
        items: [
          {
            label: t("res.toolsMode.ask"),
            icon: <Icons.ShieldAlert size={14} />,
            checked: s.tool_permission_mode === "ask",
            onSelect: () => void setPermissions(s, "ask"),
          },
          {
            label: t("res.toolsMode.all"),
            icon: <Icons.ShieldCheck size={14} />,
            checked: s.tool_permission_mode === "all",
            onSelect: () => void setPermissions(s, "all"),
          },
          {
            label: t("res.toolsMode.some"),
            icon: <Icons.ListChecks size={14} />,
            checked: s.tool_permission_mode === "some",
            onSelect: () => {
              setPicked(keyOf(s));
              setPermissionServer(keyOf(s));
              setPermissionRequest((n) => n + 1);
            },
          },
        ],
      },
      ...[
        {
          label: s.trusted ? t("mcp.revoke") : t("mcp.approve"),
          icon: <Icons.ShieldCheck size={14} />,
          onSelect: () =>
            void trustMcp(s.scope === "project" ? s.project_id : undefined, s.name, !s.trusted).then(changed),
        },
      ],
      ...(inherited && projectId
        ? [
            {
              label: s.off_here ? t("res.turnOnHere") : t("res.turnOffHere"),
              icon: <Icons.Power size={14} />,
              onSelect: () => void toggleMcp(projectId, s.name, Boolean(s.off_here)).then(changed),
            },
          ]
        : []),
      ...(s.definition && (!isGlobal(s) || !projectId)
        ? [
            { type: "separator" as const },
            { label: t("res.remove"), icon: <Icons.Trash2 size={14} />, danger: true, onSelect: () => setRemoving(s) },
          ]
        : []),
    ];
  };
  const row = (s: McpServerStatus) => (
    <ContextMenu key={keyOf(s)} items={actions(s)}>
      <PickRow
        mono
        title={s.name}
        description={s.off_here ? t("res.offHere") : s.tools ? t("mcp.tools", { n: s.tools }) : t(STATUS_KEY[s.status])}
        trailing={
          <>
            <Tag>{s.transport}</Tag>
            <PermissionIndicator mode={s.tool_permission_mode} />
          </>
        }
        dot={mcpDot(s)}
        muted={s.off_here || s.status === "disabled"}
        selected={keyOf(s) === picked}
        onClick={() => setPicked(keyOf(s))}
      />
    </ContextMenu>
  );

  const newServer = adding && (
    <McpDialog
      onClose={() => setAdding(false)}
      onSaved={async (name) => {
        setAdding(false);
        await res.loadServers();
        setPicked(`global::${name}`);
      }}
    />
  );
  // None at all yet: the invitation alone, no empty list beside it.
  if (all && !all.length && !projectId)
    return (
      <div className="resvars">
        <EmptyState
          variant="dashed"
          icon={<Icons.Server />}
          title={t("res.noMcp")}
          action={
            <Button size="sm" leadingIcon={<Icons.Plus size={14} />} onClick={() => setAdding(true)}>
              {t("res.add.mcp")}
            </Button>
          }
        />
        {newServer}
      </div>
    );
  return (
    <>
      <MasterDetail
        resizeKey="mcp"
        listLabel={t("res.tab.mcp")}
        backLabel={t("res.tab.mcp")}
        onBack={() => setPicked(undefined)}
        list={
          all && !shown.length ? (
            <EmptyState variant="dashed" size="sm" icon={<Icons.Server />}>
              {query ? t("res.noMatch") : t("res.noMcp")}
            </EmptyState>
          ) : projectId ? (
            <ScopedGroups
              ownTitle={groups[0]?.title ?? ""}
              own={groups[0]?.items ?? []}
              globals={groups[1]?.items ?? []}
              inherit={inherit}
              emptyOwn={t("res.noOwnMcp")}
              render={row}
              ownOnly={ownOnly}
            />
          ) : (
            groups
              .filter((g) => g.items.length)
              .map((g) => (
                <div key={g.title} className="resv__group">
                  <div className="resv__grouptitle">
                    {g.title} <span>{g.items.length}</span>
                  </div>
                  {g.items.map(row)}
                </div>
              ))
          )
        }
        detail={
          current && (
            <McpDetail
              key={keyOf(current)}
              server={current}
              projectId={projectId}
              onChanged={changed}
              onEdit={() => setEditing(current)}
              onRemove={() => setRemoving(current)}
              testRequest={testRequest}
              permissionRequest={permissionServer === keyOf(current) ? permissionRequest : 0}
              toolReload={toolReload}
            />
          )
        }
        empty={
          <EmptyState variant="dashed" icon={<Icons.Server />} title={t("res.pickMcp.title")}>
            {t("res.pickMcp.body")}
          </EmptyState>
        }
      />
      {editing && (
        <McpDialog
          server={editing}
          onClose={() => setEditing(undefined)}
          onSaved={async () => {
            setEditing(undefined);
            await changed();
          }}
        />
      )}
      {removing && (
        <Dialog
          open
          onOpenChange={(o) => !o && setRemoving(undefined)}
          title={t("res.mcpRemoveTitle", { name: removing.name })}
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
                  void setMcp(name, null, removing.scope === "project" ? removing.project_id : undefined).then(changed);
                }}
              >
                {t("res.remove")}
              </Button>
            </>
          }
        >
          <p className="resd__note">
            {removing.scope === "project" ? t("res.mcpRemoveProjectBody") : t("res.mcpRemoveBody")}
          </p>
        </Dialog>
      )}
      {newServer}
    </>
  );
}

function PermissionIndicator({ mode }: { mode: McpServerStatus["tool_permission_mode"] }) {
  const t = useT();
  const Icon =
    mode === "all"
      ? Icons.ShieldCheck
      : mode === "some"
        ? Icons.ListChecks
        : mode === "ask"
          ? Icons.ShieldAlert
          : Icons.CircleDashed;
  const label = `${t("res.toolsMode")}: ${t(`res.toolsMode.${mode}`)}`;
  return (
    <span className={`mcp-permission is-${mode}`} role="img" aria-label={label} title={label}>
      <Icon size={14} aria-hidden="true" />
    </span>
  );
}
