import type { ToolApproval } from "@apx/protocol";
import { ActionGroup, Button, Icons } from "@apx/ui";
import { useState } from "react";
import { listApprovals, revokeApproval } from "../data/resources.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";

export function ApprovedTools() {
  const t = useT();
  const projects = useData((s) => s.projects);
  const serverLabel = (r: ToolApproval) => {
    try {
      const [scope, project, name] = JSON.parse(r.server) as string[];
      const owner = projects.find((p) => p.id === (r.project_id ?? project));
      return `${name} · ${owner?.name ?? t(scope === "global" ? "res.scope.global" : "res.scope.project")}`;
    } catch {
      return r.server;
    }
  };
  const threads = useData((s) => s.threads);
  const agents = useData((s) => s.agents);
  const [rows, setRows] = useState<ToolApproval[]>();
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    setRows(await listApprovals());
    setBusy(false);
  };
  return (
    <ActionGroup icon={<Icons.ShieldCheck size={14} />} title={t("res.approvedTools")}>
      <Button size="sm" variant="secondary" loading={busy} onClick={() => void load()}>
        {t("common.refresh")}
      </Button>
      {rows?.length === 0 && <p className="resd__muted">{t("res.noApprovedTools")}</p>}
      <ul className="resd__toggles">
        {rows?.map((r) => (
          <li key={`${r.key}:${r.thread_id ?? ""}:${r.agent_id ?? ""}`}>
            <span>
              <code>
                {serverLabel(r)}: {r.tool}
              </code>{" "}
              ·{" "}
              {r.scope === "session"
                ? t("input.sessionScope")
                : r.agent_id
                  ? (agents[r.agent_id]?.name ?? r.agent_id)
                  : t("input.alwaysScope")}
              {r.thread_id && <span> · {threads[r.thread_id]?.title ?? t("input.sessionScope")}</span>}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await revokeApproval(r.key, r.thread_id, r.agent_id);
                setRows(await listApprovals());
                setBusy(false);
              }}
            >
              {t("mcp.revoke")}
            </Button>
          </li>
        ))}
      </ul>
    </ActionGroup>
  );
}
