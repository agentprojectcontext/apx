import type { McpServerStatus } from "@apx/protocol";
import { Badge, Button, EmptyState, Icons, SettingRow } from "@apx/ui";
import { useCallback, useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useData } from "../data/state.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { SectionHead, SubHead } from "./SectionHead.tsx";

const STATUS: Record<McpServerStatus["status"], { key: MessageKey; tone: "brand" | "neutral" | "warning" | "danger" }> =
  {
    ready: { key: "mcp.status.ready", tone: "brand" },
    off: { key: "mcp.status.off", tone: "neutral" },
    starting: { key: "mcp.status.starting", tone: "neutral" },
    disabled: { key: "mcp.status.disabled", tone: "neutral" },
    "needs-approval": { key: "mcp.status.needsApproval", tone: "warning" },
    error: { key: "mcp.status.error", tone: "danger" },
  };

/** MCP servers agents may use: the owner's own and each project's, which run only once approved. */
export function McpSection() {
  const t = useT();
  const projects = useData((s) => s.projects);
  const [servers, setServers] = useState<McpServerStatus[] | undefined>();
  const load = useCallback(async () => {
    try {
      setServers((await client.call("mcp.list", {})).servers);
    } catch {
      setServers([]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const trust = async (s: McpServerStatus, trusted: boolean) => {
    if (!s.project_id) return;
    try {
      await client.call("mcp.trust", { project: s.project_id, server: s.name, trusted });
      await load();
    } catch (e) {
      notify(t("error.mcpTrust", { error: e instanceof Error ? e.message : String(e) }));
    }
  };
  const groups = new Map<string, McpServerStatus[]>();
  for (const s of servers ?? []) {
    const key = s.scope === "global" ? "" : (s.project_id ?? "");
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return (
    <>
      <SectionHead
        title={t("config.mcp")}
        lead={t("mcp.lead")}
        actions={
          <Button size="sm" variant="secondary" leadingIcon={<Icons.RefreshCw size={14} />} onClick={() => void load()}>
            {t("common.refresh")}
          </Button>
        }
      />
      {servers && !servers.length && (
        <EmptyState variant="dashed" icon={<Icons.Server />} title={t("mcp.empty.title")}>
          {t("mcp.empty.body")}
        </EmptyState>
      )}
      {[...groups.entries()].map(([pid, list]) => (
        <div key={pid || "global"}>
          <SubHead>{pid ? (projects.find((p) => p.id === pid)?.name ?? pid) : t("mcp.global")}</SubHead>
          {list.map((s) => (
            <SettingRow
              key={`${pid}:${s.name}`}
              title={
                <span className="mcp__title">
                  {s.name}
                  <Badge tone={STATUS[s.status].tone}>{t(STATUS[s.status].key)}</Badge>
                  {s.tools > 0 && <span className="mcp__tools">{t("mcp.tools", { n: s.tools })}</span>}
                </span>
              }
              description={
                <span className="mcp__target" title={s.target}>
                  {s.error ?? s.target}
                </span>
              }
            >
              {s.scope === "project" &&
                (s.trusted ? (
                  <Button size="sm" variant="secondary" onClick={() => void trust(s, false)}>
                    {t("mcp.revoke")}
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => void trust(s, true)}>
                    {t("mcp.approve")}
                  </Button>
                ))}
            </SettingRow>
          ))}
        </div>
      ))}
    </>
  );
}
