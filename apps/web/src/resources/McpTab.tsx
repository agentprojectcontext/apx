import type { McpServerStatus } from "@apx/protocol";
import { EmptyState, Icons, MasterDetail, PickRow, Tag } from "@apx/ui";
import { useState } from "react";
import { projectName } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { mcpDot, STATUS_KEY } from "./labels.ts";
import { McpDetail } from "./McpDetail.tsx";
import { McpDialog } from "./McpDialog.tsx";
import type { TabProps } from "./ResourcesView.tsx";

const keyOf = (s: McpServerStatus) => `${s.scope}:${s.project_id ?? ""}:${s.name}`;

/** MCP servers: inside a project its own and the inherited global ones (each can be turned off here). */
export function McpTab({ projectId, query, scope, adding, setAdding, res }: TabProps) {
  const t = useT();
  const projects = useData((s) => s.projects);
  const [picked, setPicked] = useState<string>();
  const all = res.data.servers;
  const shown = (all ?? []).filter(
    (s) =>
      (!query || `${s.name} ${s.target} ${s.tool_names.join(" ")}`.toLowerCase().includes(query)) &&
      (projectId ? s.scope === "global" || s.project_id === projectId : true) &&
      (projectId || scope === "all" || (scope === "global" ? s.scope === "global" : s.project_id === scope)),
  );
  const groups = projectId
    ? [
        {
          title: t("res.group.own", { name: projectName(projects, projectId) }),
          items: shown.filter((s) => s.scope === "project"),
        },
        { title: t("res.group.inherited"), items: shown.filter((s) => s.scope === "global") },
      ]
    : [
        { title: t("res.scope.global"), items: shown.filter((s) => s.scope === "global") },
        ...projects
          .filter((p) => shown.some((s) => s.project_id === p.id))
          .map((p) => ({ title: p.name, items: shown.filter((s) => s.project_id === p.id) })),
      ];
  const current = (all ?? []).find((s) => keyOf(s) === picked);

  return (
    <>
      <MasterDetail
        listLabel={t("res.tab.mcp")}
        backLabel={t("res.tab.mcp")}
        onBack={() => setPicked(undefined)}
        list={
          all && !shown.length ? (
            <EmptyState variant="dashed" size="sm" icon={<Icons.Server />}>
              {query ? t("res.noMatch") : t("res.noMcp")}
            </EmptyState>
          ) : (
            groups
              .filter((g) => g.items.length)
              .map((g) => (
                <div key={g.title} className="resv__group">
                  <div className="resv__grouptitle">
                    {g.title} <span>{g.items.length}</span>
                  </div>
                  {g.items.map((s) => (
                    <PickRow
                      key={keyOf(s)}
                      mono
                      title={s.name}
                      description={
                        s.off_here
                          ? t("res.offHere")
                          : s.tools
                            ? t("mcp.tools", { n: s.tools })
                            : t(STATUS_KEY[s.status])
                      }
                      trailing={<Tag>{s.transport}</Tag>}
                      dot={mcpDot(s)}
                      muted={s.off_here || s.status === "disabled"}
                      selected={keyOf(s) === picked}
                      onClick={() => setPicked(keyOf(s))}
                    />
                  ))}
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
              onChanged={() => res.loadServers()}
            />
          )
        }
        empty={
          <EmptyState variant="dashed" icon={<Icons.Server />} title={t("res.pickMcp.title")}>
            {t("res.pickMcp.body")}
          </EmptyState>
        }
      />
      {adding && (
        <McpDialog
          onClose={() => setAdding(false)}
          onSaved={async (name) => {
            setAdding(false);
            await res.loadServers();
            setPicked(`global::${name}`);
          }}
        />
      )}
    </>
  );
}
