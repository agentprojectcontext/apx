import {
  type Agent,
  type Autonomy,
  DEFAULT_AUTONOMY,
  type Params,
  type Result,
  type ToolApproval,
} from "@apx/protocol";
import { AgentAvatar, Button, Dialog, Icons, Kbd, NavItem, SearchField, Skeleton } from "@apx/ui";
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { client } from "../../data/client.ts";
import { blobOf } from "../../data/identity.ts";
import { activeProfileName, loadProfiles, useProfiles } from "../../data/profiles.ts";
import { revokeApproval } from "../../data/resources.ts";
import { useData } from "../../data/state.ts";
import { agentToolCatalog, getAgent, setGrant, updateAgent } from "../../data/team.ts";
import { type MessageKey, useLanguage, useT } from "../../i18n/index.ts";
import { LAYOUT } from "../../shell/layout.ts";
import { GrantsPage, SkillsTab, ToolsTab } from "./AgentAccess.tsx";
import { ComputerPage } from "./editor/ComputerPage.tsx";
import { type Draft, type GrantChange, grantId, type PageId, sameValue } from "./editor/draft.ts";
import { IdentityPage, PromptPage, TeamPage } from "./editor/IdentityPages.tsx";
import { useModifierHeld } from "./editor/keys.ts";
import { ProfilePage } from "./editor/ProfilePage.tsx";
import { AutonomyPage, BrowserPage, RulesPage } from "./editor/RulesPages.tsx";
import { teamLead } from "./lead.ts";

type Catalog = Result<"agents.tools">["tools"];

const NAV: Array<{ label: MessageKey; items: Array<{ id: PageId; icon: ReactNode }> }> = [
  {
    label: "agentedit.group.general",
    items: [
      { id: "identity", icon: <Icons.User /> },
      { id: "prompt", icon: <Icons.FileText /> },
      { id: "team", icon: <Icons.Sparkles /> },
      { id: "profile", icon: <Icons.Calendar /> },
    ],
  },
  {
    label: "agentedit.group.abilities",
    items: [
      { id: "tools", icon: <Icons.Wrench /> },
      { id: "skills", icon: <Icons.Brain /> },
    ],
  },
  {
    label: "agentedit.group.permissions",
    items: [
      { id: "autonomy", icon: <Icons.Zap /> },
      { id: "rules", icon: <Icons.ListChecks /> },
      { id: "granted", icon: <Icons.Check /> },
      { id: "browser", icon: <Icons.Globe /> },
      { id: "computer", icon: <Icons.AppWindow /> },
    ],
  },
];

const SIZE = {
  width: `min(${LAYOUT.configW}px, calc(100vw - 64px))`,
  height: `min(${LAYOUT.configH}px, calc(100vh - 64px))`,
  "--config-nav-w": "240px",
} as CSSProperties;

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

/** `lead`: it heads its team now, marked or guessed by its role, so the switch shows what the chart shows. */
const draftOf = (a: Agent, prompt: string, lead: boolean): Draft => ({
  name: a.name,
  role: a.role,
  area: a.area ?? "",
  description: a.description ?? "",
  personality: a.personality ?? "",
  blob: blobOf(a) ?? "",
  prompt,
  tools: a.tools ?? [],
  skills: a.skills ?? [],
  orchestrator: a.orchestrator ?? lead,
  autonomy: a.autonomy ?? "",
  rules: a.rules ?? {},
  parent: a.parent ?? "",
  browser_profile: a.browser_profile,
});

/** What agents.update takes for each changed draft field. */
function fieldsOf(d: Draft, changed: Array<keyof Draft>): Omit<Params<"agents.update">, "agent"> {
  const out: Record<string, unknown> = {};
  for (const k of changed) {
    if (k === "autonomy") out.autonomy = d.autonomy || null;
    else if (k === "rules") out.rules = Object.keys(d.rules).length ? d.rules : null;
    else out[k] = d[k];
  }
  return out as Omit<Params<"agents.update">, "agent">;
}

/**
 * The whole agent in one place, laid out like Config: who it is, its prompt, model and team, the tools and skills it
 * may use, and how far it goes on its own (autonomy, rules by case, what was granted, the browser). Everything but the
 * model and the budget is saved together; a project agent's definition goes to its `.apc/agents/<slug>.md`.
 */
export function AgentEditor({
  agent,
  onClose,
  start = "identity",
}: {
  agent: Agent;
  onClose: () => void;
  /** The page it opens on ("permissions" is the granted page). */
  start?: PageId | "permissions";
}) {
  const t = useT();
  const [base, setBase] = useState<Draft>();
  const [d, setD] = useState<Draft>();
  const [page, setPage] = useState<PageId>(start === "permissions" ? "granted" : start);
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  const [catalog, setCatalog] = useState<Catalog>();
  const [grants, setGrants] = useState<ToolApproval[]>();
  const [grantChanges, setGrantChanges] = useState<Record<string, GrantChange>>({});
  const live = useData((s) => s.agents[agent.id]) ?? agent;
  const agents = useData((s) => s.agents);
  const team = useMemo(
    () => Object.values(agents).filter((a) => a.project_id === agent.project_id),
    [agents, agent.project_id],
  );
  const project = useData((s) => (agent.project_id ? s.projects.find((p) => p.id === agent.project_id) : undefined));
  const baseProject = useData((s) => s.base);
  const projectAutonomy: Autonomy = (agent.project_id ? project?.autonomy : baseProject.autonomy) ?? DEFAULT_AUTONOMY;
  const projectName = project?.name ?? baseProject.name;
  const isSuper = agent.kind === "secretary";
  const lang = useLanguage();
  const profileName = useProfiles((s) => activeProfileName(s, lang));

  useEffect(() => {
    if (isSuper) void loadProfiles();
  }, [isSuper]);

  const teamRef = useRef(team);
  teamRef.current = team;
  useEffect(() => {
    let current = true;
    void getAgent(agent.id).then((r) => {
      if (!current || !r) return;
      const start = draftOf(r.agent, r.prompt, teamLead(teamRef.current)?.id === agent.id);
      setBase(start);
      setD(start);
    });
    void agentToolCatalog().then((c) => current && c && setCatalog(c));
    void client
      .call("tools.approvals", {})
      .then((r) => current && setGrants(r.approvals.filter((g) => g.scope === "always")))
      .catch(() => current && setGrants([]));
    return () => {
      current = false;
    };
  }, [agent.id]);

  const changed = base && d ? (Object.keys(d) as Array<keyof Draft>).filter((k) => !sameValue(d[k], base[k])) : [];
  const dirty = changed.length > 0 || Object.keys(grantChanges).length > 0;
  const loadGrants = () =>
    void client
      .call("tools.approvals", {})
      .then((r) => setGrants(r.approvals.filter((g) => g.scope === "always")))
      .catch(() => {});
  /** Saves what changed; `close` also closes the editor, else it stays open on what was saved. */
  const save = async (close: boolean) => {
    if (!d?.name.trim() || saving) return;
    if (!dirty) return close ? onClose() : undefined;
    setSaving(true);
    let ok = !changed.length || (await updateAgent(agent.id, fieldsOf(d, changed)));
    for (const [id, c] of Object.entries(grantChanges)) {
      const g = grants?.find((x) => grantId(x.key, x.agent_id) === id);
      if (!g) continue;
      if (c.revoke) await revokeApproval(g.key, undefined, g.agent_id);
      else
        ok =
          (await setGrant(g.key, g.agent_id, {
            ...(c.condition !== undefined ? { condition: c.condition } : {}),
            ...(c.expires_at !== undefined ? { expires_at: c.expires_at } : {}),
          })) && ok;
    }
    setSaving(false);
    if (!ok) return;
    if (close) return onClose();
    setBase(d);
    if (Object.keys(grantChanges).length) {
      setGrantChanges({});
      loadGrants();
    }
  };
  // ⌘S saves and goes on, ⇧⌘S saves and closes (Ctrl elsewhere).
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      void saveRef.current(e.shiftKey);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const hints = useModifierHeld();
  const edit = (patch: Partial<Draft>) => setD((cur) => (cur ? { ...cur, ...patch } : cur));

  const mine = (grants ?? []).filter((g) => g.agent_id === agent.id || !g.agent_id);
  const nGrants = mine.filter((g) => !grantChanges[grantId(g.key, g.agent_id)]?.revoke).length;
  const metaOf = (id: PageId): string => {
    if (!d) return "";
    if (id === "tools") {
      // Only what APX knows counts; names another app wrote restrict nothing.
      const names = new Set([...(catalog ?? []).map((x) => x.name), ...(catalog ?? []).flatMap((x) => x.group ?? [])]);
      const n = d.tools.filter((x) => names.has(x) || x.toLowerCase().startsWith("mcp_")).length;
      return n ? String(n) : t("agentedit.all");
    }
    if (id === "skills") return d.skills.length ? String(d.skills.length) : t("agentedit.all");
    if (id === "autonomy") return d.autonomy ? t("agentedit.own") : t("agentedit.fromProject");
    if (id === "rules") {
      const n = Object.keys(d.rules).length;
      return n ? t("agentedit.ownRules", { count: n }) : "";
    }
    if (id === "granted") return grants ? String(nGrants) : "";
    if (id === "profile") return profileName === undefined ? "" : (profileName ?? t("prof.none"));
    return "";
  };
  const query = q.trim().toLowerCase();
  const matches = (id: PageId) =>
    (id !== "profile" || isSuper) &&
    (!query ||
      t(`agentedit.page.${id}`).toLowerCase().includes(query) ||
      (id === "tools" && Boolean(catalog?.some((x) => x.name.includes(query)))));
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => matches(i.id)) })).filter((g) => g.items.length);
  const file = agent.source === "apc" && agent.slug ? `.apc/agents/${agent.slug}.md` : undefined;

  const body = (): ReactNode => {
    if (!d) return <Skeleton shape="block" height={240} />;
    const common = { agent: live, draft: d, edit };
    switch (page) {
      case "identity":
        return <IdentityPage {...common} isSuper={isSuper} team={team} />;
      case "prompt":
        return <PromptPage {...common} isSuper={isSuper} />;
      case "team":
        return <TeamPage {...common} isSuper={isSuper} team={team} file={file} />;
      case "profile":
        return <ProfilePage agent={live} onClose={onClose} />;
      case "tools":
        return (
          <ToolsTab
            value={d.tools}
            onChange={(tools) => edit({ tools })}
            catalog={catalog}
            draft={d}
            projectAutonomy={projectAutonomy}
            granted={mine}
            onRules={() => setPage("rules")}
          />
        );
      case "skills":
        return <SkillsTab agent={agent} value={d.skills} onChange={(skills) => edit({ skills })} />;
      case "autonomy":
        return <AutonomyPage {...common} projectAutonomy={projectAutonomy} onRules={() => setPage("rules")} />;
      case "rules":
        return (
          <RulesPage
            {...common}
            catalog={catalog}
            granted={mine}
            projectAutonomy={projectAutonomy}
            projectName={projectName}
            onAutonomy={() => setPage("autonomy")}
          />
        );
      case "granted":
        return (
          <GrantsPage
            agent={agent}
            grants={grants}
            changes={grantChanges}
            onChange={(id, c) =>
              setGrantChanges((cur) => {
                const next = { ...cur };
                if (c) next[id] = { ...cur[id], ...c };
                else delete next[id];
                return next;
              })
            }
          />
        );
      case "browser":
        return <BrowserPage {...common} projectAutonomy={projectAutonomy} onRules={() => setPage("rules")} />;
      case "computer":
        return <ComputerPage agent={agent} grants={grants} onChanged={loadGrants} />;
    }
  };

  return (
    <Dialog
      bare
      size="xl"
      title={isSuper ? t("agent.edit.superTitle") : t("agent.edit.title", { name: agent.name })}
      closeLabel={t("common.close")}
      open
      onOpenChange={(o) => !o && onClose()}
      className="config agentedit"
      style={SIZE}
    >
      <nav className="config__nav" aria-label={t("agent.edit.title", { name: agent.name })}>
        <div className="agentedit__who">
          <AgentAvatar name={d?.name ?? agent.name} blob={d?.blob || blobOf(agent)} size={32} animated={false} />
          <div className="agentedit__whotext">
            <div className="agentedit__whoname">
              {d?.name ?? agent.name}
              {d?.orchestrator && (
                <Icons.Crown size={12} className="agentedit__crown" aria-label={t("agentedit.orchestrator")} />
              )}
            </div>
            <div className="agentedit__whoproject">
              <Icons.Folder size={12} />
              {projectName}
            </div>
          </div>
        </div>
        <SearchField
          size="sm"
          aria-label={t("common.search")}
          placeholder={t("common.search")}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
        />
        {groups.map((g) => (
          <div key={g.label} className="config__group">
            <div className="config__grouplabel">{t(g.label)}</div>
            {g.items.map((i) => (
              <NavItem
                key={i.id}
                className="config__navitem"
                icon={i.icon}
                label={t(`agentedit.page.${i.id}`)}
                trailing={metaOf(i.id) ? <span className="agentedit__meta">{metaOf(i.id)}</span> : undefined}
                active={page === i.id}
                onClick={() => setPage(i.id)}
              />
            ))}
          </div>
        ))}
      </nav>
      <div className="agentedit__main">
        <div className="config__content">
          <div className="config__inner">
            <div className="config__head">
              <div className="config__headtext">
                <h2 className="config__title">
                  {isSuper && page === "prompt" ? t("agent.edit.superPrompt") : t(`agentedit.page.${page}`)}
                </h2>
                <p className="config__lead">{t(`agentedit.page.${page}Sub`)}</p>
              </div>
            </div>
            {body()}
          </div>
        </div>
        <footer className="agentedit__foot">
          <span className="agentedit__file">
            {dirty && <span className="agentedit__dot" aria-hidden />}
            {dirty ? `${t("agentedit.unsaved")} · ` : ""}
            {file ? t("agentedit.savedTo", { file }) : t("agentedit.savedLocal")}
          </span>
          <Button
            variant="ghost"
            disabled={!dirty}
            onClick={() => {
              setD(base);
              setGrantChanges({});
            }}
          >
            {t("agentedit.discard")}
          </Button>
          <Button
            variant="secondary"
            disabled={!d?.name.trim() || !dirty || saving}
            onClick={() => void save(false)}
            trailingIcon={hints ? <Kbd keys={[MOD, "S"]} /> : undefined}
          >
            {t("common.save")}
          </Button>
          <Button
            loading={saving}
            disabled={!d?.name.trim() || !dirty}
            onClick={() => void save(true)}
            trailingIcon={hints ? <Kbd keys={["⇧", MOD, "S"]} /> : undefined}
          >
            {t("agentedit.saveClose")}
          </Button>
        </footer>
      </div>
    </Dialog>
  );
}
