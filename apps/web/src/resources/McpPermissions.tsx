import type { McpServerStatus } from "@apx/protocol";
import { Button } from "@apx/ui";
import { useState } from "react";
import { approveMcpTool, mcpPermissions, revokeApproval } from "../data/resources.ts";
import { useT } from "../i18n/index.ts";

type Permission = { name: string; key: string; permanent: boolean; approved: boolean };

export function McpPermissions({ server, projectId }: { server: McpServerStatus; projectId?: string | undefined }) {
  const t = useT();
  const [tools, setTools] = useState<Permission[]>();
  const [busy, setBusy] = useState(false);
  const project = server.scope === "project" ? server.project_id : (projectId ?? server.project_id);
  const load = async () => {
    setBusy(true);
    setTools(await mcpPermissions(server, project));
    setBusy(false);
  };
  const change = async (tool: Permission) => {
    setBusy(true);
    const result = tool.approved ? await revokeApproval(tool.key) : await approveMcpTool(server, tool.name, project);
    if (result) setTools(await mcpPermissions(server, project));
    setBusy(false);
  };
  return (
    <section className="resd__section">
      <h3 className="resd__h3">{t("res.permissions")}</h3>
      <p className="resd__note">{t("res.approvalHelp")}</p>
      <Button
        size="sm"
        variant="secondary"
        loading={busy}
        disabled={!server.trusted || !server.enabled}
        onClick={() => void load()}
      >
        {t("res.loadTools")}
      </Button>
      {server.trusted && tools && (
        <ul className="resd__toggles">
          {tools.map((tool) => (
            <li key={tool.key}>
              <code>{tool.name}</code>
              {tool.permanent ? (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void change(tool)}>
                  {t(tool.approved ? "mcp.revoke" : "input.approveAlways")}
                </Button>
              ) : (
                <span className="resd__muted">{t("res.sessionOnly")}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
