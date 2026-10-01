import type { McpServerStatus } from "@apx/protocol";
import { Badge, Button, EmptyState, Icons } from "@apx/ui";
import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import type { ProjectEntry } from "../data/identity.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";

type Skill = { name: string; description: string; scope: "global" | "project" };

const MCP_STATUS: Record<
  McpServerStatus["status"],
  { key: MessageKey; tone: "brand" | "neutral" | "warning" | "danger" }
> = {
  ready: { key: "mcp.status.ready", tone: "brand" },
  off: { key: "mcp.status.off", tone: "neutral" },
  starting: { key: "mcp.status.starting", tone: "neutral" },
  disabled: { key: "mcp.status.disabled", tone: "neutral" },
  "needs-approval": { key: "mcp.status.needsApproval", tone: "warning" },
  error: { key: "mcp.status.error", tone: "danger" },
};

/** What the project's agents can use: its own skills and MCP servers, then the owner's global ones they inherit. */
export function ProjectResources({ project }: { project: ProjectEntry }) {
  const t = useT();
  const [skills, setSkills] = useState<Skill[] | undefined>();
  const [servers, setServers] = useState<McpServerStatus[] | undefined>();
  useEffect(() => {
    const p = project.isDefault ? {} : { project: project.id };
    client
      .call("skills.list", p)
      .then((r) => setSkills(r.skills))
      .catch(() => setSkills([]));
    client
      .call("mcp.list", p)
      .then((r) => setServers(r.servers))
      .catch(() => setServers([]));
  }, [project.id, project.isDefault]);

  const byScope = <X extends { scope: string }>(xs: X[] | undefined) => [
    ...(xs ?? []).filter((x) => x.scope === "project"),
    ...(xs ?? []).filter((x) => x.scope !== "project"),
  ];

  return (
    <div className="memory">
      <section className="res">
        <div className="team__head">
          <div className="team__titles">
            <div className="team__title">
              {t("res.skills")} {skills && <span className="team__count">{skills.length}</span>}
            </div>
            <div className="team__note">
              {t("res.skillsBefore")}
              <code>.apc/skills/</code>
              {t("res.skillsAfter")}
            </div>
          </div>
        </div>
        {skills && !skills.length ? (
          <EmptyState variant="dashed" size="sm" icon={<Icons.Sparkles />}>
            {t("res.noSkills")}
          </EmptyState>
        ) : (
          <ul className="res__list">
            {byScope(skills).map((s) => (
              <li key={`${s.scope}:${s.name}`} className="res__row">
                <Icons.Sparkles size={14} className="res__icon" />
                <div className="res__main">
                  <div className="res__name">{s.name}</div>
                  <div className="res__desc">{s.description}</div>
                </div>
                <Badge tone={s.scope === "project" ? "brand" : "neutral"}>
                  {s.scope === "project" ? t("res.ofProject") : t("res.global")}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="res">
        <div className="team__head">
          <div className="team__titles">
            <div className="team__title">
              {t("res.mcp")} {servers && <span className="team__count">{servers.length}</span>}
            </div>
            <div className="team__note">
              {t("res.mcpBefore")}
              <code>.apc/mcps.json</code>
              {t("res.mcpAfter")}
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={<Icons.Settings size={14} />}
            onClick={() => go.config("mcp")}
          >
            {t("res.manage")}
          </Button>
        </div>
        {servers && !servers.length ? (
          <EmptyState variant="dashed" size="sm" icon={<Icons.Server />}>
            {t("res.noMcp")}
          </EmptyState>
        ) : (
          <ul className="res__list">
            {byScope(servers).map((s) => {
              const st = MCP_STATUS[s.status];
              return (
                <li key={`${s.scope}:${s.project_id ?? ""}:${s.name}`} className="res__row">
                  <Icons.Server size={14} className="res__icon" />
                  <div className="res__main">
                    <div className="res__name">{s.name}</div>
                    <div className="res__desc res__mono">{s.target}</div>
                  </div>
                  <Badge tone={st.tone} dot>
                    {t(st.key)}
                  </Badge>
                  <Badge tone={s.scope === "project" ? "brand" : "neutral"}>
                    {s.scope === "project" ? t("res.ofProject") : t("res.global")}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
