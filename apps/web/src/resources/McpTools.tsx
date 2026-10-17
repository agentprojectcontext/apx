import type { McpServerStatus, ToolApproval } from "@apx/protocol";
import { Button, Icons, SegmentedControl } from "@apx/ui";
import { useEffect, useState } from "react";
import { approveMcpTool, listApprovals, mcpPermissions, revokeApproval, setMcpToolMode } from "../data/resources.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { serverApproval } from "./serverId.ts";

type Permission = { name: string; key: string; permanent: boolean; approved: boolean };
type Mode = "ask" | "all" | "some";

const ofServer = (s: McpServerStatus) => (g: ToolApproval) => {
  const id = serverApproval(g.server);
  return (
    !!id &&
    id.scope === s.scope &&
    id.name === s.name &&
    id.project === (s.scope === "project" ? (s.project_id ?? "") : "")
  );
};

/**
 * A server's tools and who may use them without asking: every agent (chosen here, all or some), or one agent or chat
 * (chosen when an agent asked). Loading the list starts the server, as a test would.
 */
export function McpTools({
  server: s,
  projectId,
  names,
  reload,
  pickRequest = 0,
  onLoaded,
}: {
  server: McpServerStatus;
  projectId: string | undefined;
  /** What is known without starting it (status, last test). */
  names: string[];
  /** Bumped after a test: the list is read again. */
  reload: string;
  /** Bumped by the list's permission menu to open the individual tool picker. */
  pickRequest?: number;
  onLoaded(): void;
}) {
  const t = useT();
  const agents = useData((st) => st.agents);
  const threads = useData((st) => st.threads);
  const [tools, setTools] = useState<Permission[]>();
  const [failed, setFailed] = useState<string>();
  const [grants, setGrants] = useState<ToolApproval[]>([]);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const project = s.scope === "project" ? s.project_id : (projectId ?? s.project_id);
  const usable = s.trusted && s.enabled && !s.off_here;

  const read = async () => {
    const [list, all] = await Promise.all([mcpPermissions(s, project), listApprovals()]);
    if (list) {
      setTools(list.error ? undefined : list.tools);
      setFailed(list.error);
    }
    setGrants((all ?? []).filter(ofServer(s)).filter((g) => g.agent_id || g.thread_id));
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: read again for another server or after a test
  useEffect(() => {
    if (!usable) return;
    setBusy(true);
    void read().finally(() => {
      setBusy(false);
      onLoaded();
    });
  }, [s.name, s.scope, project, usable, reload]);
  useEffect(() => {
    setPicking(pickRequest > 0);
  }, [pickRequest]);

  const allowed = tools?.filter((x) => x.approved).length ?? 0;
  const mode: Mode = picking ? "some" : !allowed ? "ask" : allowed === tools?.length ? "all" : "some";
  const apply = async (change: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await change();
      await read();
      onLoaded();
    } finally {
      setBusy(false);
    }
  };
  const setMode = (m: Mode) => {
    if (busy) return;
    setPicking(m === "some");
    if (!tools || m === "some") return;
    void apply(() => setMcpToolMode(s, m, project));
  };
  const toggle = (x: Permission) => {
    setPicking(false);
    void apply(() => (x.approved ? revokeApproval(x.key) : approveMcpTool(s, x.name, project)));
  };

  const shown = tools ?? names.map((name) => ({ name, key: name, permanent: false, approved: false }));
  return (
    <section className="resd__section mcptools">
      <div className="mcptools__head">
        <h3 className="resd__h3">
          {t("res.tools")} {shown.length > 0 && <span className="resd__count">{shown.length}</span>}
        </h3>
        {tools && tools.length > 0 && (
          <SegmentedControl
            size="sm"
            label={t("res.toolsMode")}
            value={mode}
            onValueChange={(v) => setMode(v as Mode)}
            options={[
              { value: "ask", label: t("res.toolsMode.ask") },
              { value: "all", label: t("res.toolsMode.all") },
              { value: "some", label: t("res.toolsMode.some") },
            ]}
          />
        )}
      </div>
      {tools && tools.length > 0 && (
        <p className="resd__muted">
          {mode === "some" ? t("res.toolsPick") : t(mode === "all" ? "res.toolsAllHelp" : "res.toolsAskHelp")}
        </p>
      )}
      {shown.length ? (
        <div className="resd__chips">
          {shown.map((x) =>
            tools ? (
              <button
                key={x.key}
                type="button"
                className={x.approved ? "mcptools__tool is-on" : "mcptools__tool"}
                aria-pressed={x.approved}
                disabled={busy}
                onClick={() => toggle(x)}
              >
                {x.approved && <Icons.Check size={12} />}
                {x.name}
              </button>
            ) : (
              <span key={x.key} className="mcptools__tool is-static">
                {x.name}
              </span>
            ),
          )}
        </div>
      ) : (
        <p className="resd__muted">
          {busy
            ? t("res.toolsLoading")
            : failed
              ? t("res.toolsFailed", { error: failed })
              : t(usable ? "res.toolsUnknown" : "res.toolsOff")}
        </p>
      )}
      {grants.length > 0 && (
        <>
          <h4 className="mcptools__sub">{t("res.toolsGrants")}</h4>
          <ul className="resd__toggles">
            {grants.map((g) => (
              <li key={`${g.key}:${g.thread_id ?? ""}:${g.agent_id ?? ""}`}>
                <span>
                  <code>{g.tool}</code> ·{" "}
                  {g.agent_id
                    ? (agents[g.agent_id]?.name ?? g.agent_id)
                    : `${t("input.sessionScope")}: ${(g.thread_id && threads[g.thread_id]?.title) || "—"}`}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void apply(() => revokeApproval(g.key, g.thread_id, g.agent_id))}
                >
                  {t("mcp.revoke")}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
