import type { McpServerStatus } from "@apx/protocol";
import { Badge, Button, Icons, Switch } from "@apx/ui";
import { useEffect, useState } from "react";
import { projectName } from "../data/identity.ts";
import { listMcp, signInMcp, testMcp, toggleMcp, trustMcp } from "../data/resources.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { mcpDot, STATUS_KEY } from "./labels.ts";
import { McpTools } from "./McpTools.tsx";

type TestResult = { ok: boolean; ms: number; tools: string[]; error?: string | undefined };

/**
 * One MCP server: its state, what it runs, the variables it names (red when missing), its tools, and a test. Inside a
 * project a global server can be turned off for that project only; a project's server runs once the owner approves it.
 */
export function McpDetail({
  server: s,
  projectId,
  onChanged,
  onEdit,
  onRemove,
  testRequest = 0,
  permissionRequest = 0,
  toolReload = 0,
}: {
  server: McpServerStatus;
  projectId: string | undefined;
  onChanged(): Promise<void> | void;
  onEdit(): void;
  onRemove(): void;
  /** Bumped by "Test" in the list's menu: the test runs here, where its result shows. */
  testRequest?: number;
  permissionRequest?: number;
  toolReload?: number;
}) {
  const t = useT();
  const projects = useData((st) => st.projects);
  const [test, setTest] = useState<TestResult>();
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState(0);
  /** Every project gets it; one limited to a project (`only`) belongs to it. */
  const shared = s.scope === "global" && !s.only;
  const inherited = Boolean(projectId) && shared;
  const tools = test?.tools.length ? test.tools : s.tool_names;
  const run = async () => {
    setTesting(true);
    const r = await testMcp(s);
    setTesting(false);
    if (r) setTest(r);
    setTested((n) => n + 1);
    await onChanged();
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new request from the menu runs it
  useEffect(() => {
    if (testRequest) void run();
  }, [testRequest]);
  const [signingIn, setSigningIn] = useState(false);
  const signIn = async () => {
    setSigningIn(true);
    await signInMcp(s);
    setSigningIn(false);
    await onChanged();
  };
  // While its sign-in page is open, the state is read again so the end of the sign-in shows by itself.
  const waiting = s.status === "needs-sign-in" && Boolean(s.sign_in_url);
  // biome-ignore lint/correctness/useExhaustiveDependencies: polls while waiting, with the latest refresh
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => void onChanged(), 3_000);
    return () => clearInterval(id);
  }, [waiting]);

  return (
    <article className="resd">
      <header className="resd__head">
        <h2 className="resd__name">{s.name}</h2>
        <Badge>{shared ? t("res.scope.global") : t("res.scope.project")}</Badge>
        {inherited && <Badge>{t("res.inherited")}</Badge>}
        <span className="resd__spacer" />
        {inherited && projectId && (
          <Switch
            checked={!s.off_here}
            label={t("res.onHere")}
            onCheckedChange={(on) => void toggleMcp(projectId, s.name, on).then(() => onChanged())}
          />
        )}
      </header>
      <p className={`resd__status is-${s.off_here ? "off" : s.status} is-dot-${mcpDot(s)}`}>
        <span className="resd__dot" />
        {s.off_here
          ? t("res.offHereLong", { name: projectName(projects, projectId) })
          : test?.ok
            ? t("res.connected", { n: test.tools.length, ms: test.ms })
            : t(s.status === "off" ? "res.idleLong" : STATUS_KEY[s.status])}
        {!s.off_here && s.status === "ready" && !test && s.tools > 0 && ` · ${t("mcp.tools", { n: s.tools })}`}
      </p>
      {(test?.error || s.error) && <pre className="resd__error">{test?.error ?? s.error}</pre>}
      <div className="resd__row">
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<Icons.FlaskConical size={14} />}
          loading={testing}
          disabled={s.status === "needs-approval" || s.status === "needs-sign-in"}
          onClick={() => void run()}
        >
          {t("res.test")}
        </Button>
        {s.trusted && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void trustMcp(s.scope === "project" ? s.project_id : undefined, s.name, false).then(() => onChanged())
            }
          >
            {t("mcp.revoke")}
          </Button>
        )}
        {s.definition && (
          <Button size="sm" variant="ghost" leadingIcon={<Icons.Pencil size={14} />} onClick={onEdit}>
            {t("res.edit")}
          </Button>
        )}
        {s.definition && (!shared || !projectId) && (
          <Button size="sm" variant="ghost" leadingIcon={<Icons.Trash2 size={14} />} onClick={onRemove}>
            {t("res.remove")}
          </Button>
        )}
      </div>

      {inherited && (
        <p className="resd__note">{t("res.mcpInheritedNote", { name: projectName(projects, projectId) })}</p>
      )}

      {s.status === "needs-approval" && (
        <div className="resd__callout">
          <Icons.ShieldAlert size={16} />
          <div>
            <strong>{t("res.approveTitle")}</strong>
            <p>{t("res.approveBody")}</p>
          </div>
          <Button
            size="sm"
            onClick={() =>
              void trustMcp(s.scope === "project" ? s.project_id : undefined, s.name, true).then(() => onChanged())
            }
          >
            {t("mcp.approve")}
          </Button>
        </div>
      )}

      {s.status === "needs-sign-in" && (
        <div className="resd__callout resd__callout--line">
          <Icons.LogIn size={16} />
          <strong>{t(waiting ? "res.signInWaiting" : "mcp.status.needsSignIn")}</strong>
          <Button size="sm" loading={signingIn} onClick={() => void signIn()}>
            {t("res.signIn")}
          </Button>
        </div>
      )}

      <h3 className="resd__h3">{s.transport === "http" ? t("res.url") : t("res.command")}</h3>
      <pre className="resd__code">{s.target}</pre>

      <h3 className="resd__h3">{t("res.tab.variables")}</h3>
      {s.vars.length ? (
        <div className="resd__chips">
          {s.vars.map((v) => (
            <button
              key={v.name}
              type="button"
              className={v.set ? "resd__var" : "resd__var is-missing"}
              title={v.set ? t("res.varSet") : t("res.varMissing")}
              onClick={() => go.resourcesTab("variables")}
            >
              {v.name}
            </button>
          ))}
        </div>
      ) : (
        <p className="resd__muted">{t("res.noVars")}</p>
      )}

      <McpTools
        server={s}
        projectId={projectId}
        names={tools}
        reload={`${tested}:${permissionRequest}:${toolReload}`}
        pickRequest={permissionRequest}
        onLoaded={() => void onChanged()}
      />

      {!projectId && shared && <AvailableIn server={s.name} onChanged={onChanged} />}
    </article>
  );
}

/** Globally: one switch per project to turn this server off (or back on) there. */
function AvailableIn({ server, onChanged }: { server: string; onChanged(): Promise<void> | void }) {
  const t = useT();
  const projects = useData((s) => s.projects).filter((p) => p.path && p.registered !== false);
  const [off, setOff] = useState<Record<string, boolean>>({});
  const ids = projects.map((p) => p.id).join(",");
  useEffect(() => {
    const read = async (id: string) =>
      [id, (await listMcp(id))?.find((x) => x.name === server && x.scope === "global")?.off_here ?? false] as const;
    void Promise.all(ids.split(",").filter(Boolean).map(read)).then((pairs) => setOff(Object.fromEntries(pairs)));
  }, [server, ids]);
  if (!projects.length) return null;
  return (
    <section className="resd__section">
      <h3 className="resd__h3">{t("res.availableIn")}</h3>
      <ul className="resd__toggles">
        {projects.map((p) => (
          <li key={p.id}>
            <span>{p.name}</span>
            <Switch
              size="sm"
              checked={!off[p.id]}
              aria-label={t("res.availableInProject", { name: p.name })}
              onCheckedChange={(on) =>
                void toggleMcp(p.id, server, on).then((r) => {
                  if (!r) return;
                  setOff((o) => ({ ...o, [p.id]: !on }));
                  return onChanged();
                })
              }
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
