import { type Agent, Autonomy, DEFAULT_AUTONOMY, names, parentIn, reportsOf } from "@apx/protocol";
import { AgentAvatar, Button, Dialog, EngineIcon, IconButton, Icons, Menu, Tabs } from "@apx/ui";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { shortWhen } from "../../common/format.ts";
import { AgentModelPicker } from "../../config/models/AgentModelPicker.tsx";
import { setAgentBrowserProfile } from "../../data/actions.ts";
import { PROFILE_KEY } from "../../data/engines.ts";
import { blobOf, DEFAULT_PID } from "../../data/identity.ts";
import { useOrg } from "../../data/org.ts";
import { activeProfileName, loadProfiles, useProfiles } from "../../data/profiles.ts";
import { useRoutines } from "../../data/routines.ts";
import { useData } from "../../data/state.ts";
import { useTasks } from "../../data/tasks.ts";
import { getAgent, setAgentParent, updateAgent } from "../../data/team.ts";
import { useLanguage, useT } from "../../i18n/index.ts";
import { go } from "../../shell/nav.ts";
import { AgentActivity } from "./AgentActivity.tsx";
import { AgentBudgetField } from "./AgentBudgetField.tsx";
import { AgentComputer } from "./AgentComputer.tsx";
import { AgentEditor } from "./AgentEditor.tsx";
import { AgentRoutines } from "./AgentRoutines.tsx";
import { engineOf } from "./useTeamInfo.tsx";

/** How often it stops for the owner's yes, strictest first; "project" is none of its own (DECISIONS.md#d-072). */
const AUTONOMY = Autonomy.options;
const FROM_PROJECT = "project";

const PROFILES = ["shared", "isolated", "incognito"] as const;

/**
 * The selected agent beside the canvas, for a quick look and quick edits: its numbers, who it reports to (with
 * confirmation), model and browser; what it did lately; its routines. "Edit" opens the whole agent.
 */
export function AgentDetail({
  agent,
  team,
  onClose,
  onChat,
  inPanel = false,
}: {
  agent: Agent;
  team: Agent[];
  onClose(): void;
  onChat(): void;
  /** Beside a chat (the side panel) instead of the team canvas. */
  inPanel?: boolean;
}) {
  const t = useT();
  const [pending, setPending] = useState<string>();
  const [tab, setTab] = useState("summary");
  const [editing, setEditing] = useState<false | "identity" | "prompt" | "computer">(false);
  /** Bumped when the editor closes, so the prompt shown is read again. */
  const [edits, setEdits] = useState(0);
  const threads = useData((s) => s.threads);
  const tasks = useTasks((s) => s.tasks);
  const routines = useRoutines((s) => s.routines);
  const stats = useMemo(() => {
    const mine = Object.values(threads).filter((th) => th.agent_ids.includes(agent.id) && !th.parent_id);
    const last = mine.reduce<string | undefined>((m, th) => (!m || th.updated_at > m ? th.updated_at : m), undefined);
    return {
      chats: mine.filter((th) => th.kind !== "a2a" && th.kind !== "task" && th.kind !== "routine").length,
      tasks: Object.values(tasks).filter((x) => x.state === "open" && x.assignee === agent.id).length,
      routines: routines.filter((x) => x.agent_id === agent.id && x.enabled).length,
      last,
    };
  }, [threads, tasks, routines, agent.id]);
  const fromFile = agent.source === "apc" && Boolean(agent.slug);
  const org = useOrg(agent.project_id ?? DEFAULT_PID);
  const isSuper = agent.kind === "secretary";
  // A parent names a project agent by its slug and a global one (which has none) by its id.
  const keyOf = (a: Agent) => a.slug ?? (a.project_id ? undefined : a.id);
  const top = team.find((a) => a.kind === "secretary");
  // Its own reports cannot become its parent: the core refuses loops, the list does not offer them.
  const below = new Set<string>();
  const walk = (a: Agent) => {
    for (const r of reportsOf(team, a))
      if (!below.has(r.id)) {
        below.add(r.id);
        walk(r);
      }
  };
  walk(agent);
  const parents = team.filter((a) => keyOf(a) && a.id !== agent.id && !below.has(a.id));
  // `parent:` may name it by slug or full id; the picker speaks in keys.
  const up = parentIn(team, agent);
  const parentKey = (up && keyOf(up)) ?? agent.parent ?? "";
  // With no parent a global agent hangs under the super-agent; a project agent sits on top of its team.
  const noParent = !fromFile && top ? t("team.parent.toSuper", { name: top.name }) : t("team.parent.none");
  const nameOf = (key: string | undefined) => team.find((a) => names(a, key))?.name ?? noParent;
  const inherited = useData((s) =>
    agent.project_id ? s.projects.find((p) => p.id === agent.project_id)?.autonomy : s.base.autonomy,
  );
  const fromProject = t("team.autonomy.project", { level: t(`team.autonomy.${inherited ?? DEFAULT_AUTONOMY}`) });

  const facts = (
    <dl className="teamdetail__facts">
      <dt>{t("team.parent")}</dt>
      <dd>
        {isSuper ? (
          <span className="teamdetail__muted">{t("team.parent.super")}</span>
        ) : (
          <Pick
            label={t("team.parent")}
            text={nameOf(agent.parent)}
            options={[
              { value: "", text: noParent },
              ...parents.filter((p) => p.kind !== "secretary").map((p) => ({ value: keyOf(p) ?? "", text: p.name })),
            ]}
            value={parentKey}
            onPick={(v) => v !== parentKey && setPending(v)}
          />
        )}
      </dd>
      {agent.area && (
        <>
          <dt>{t("team.area")}</dt>
          <dd>{org?.areas.find((a) => a.slug === agent.area)?.name ?? agent.area}</dd>
        </>
      )}
      <dt>{t("team.engine")}</dt>
      <dd className="teamdetail__engine">
        <EngineIcon engine={engineOf(agent)} size={14} />
        <AgentModelPicker agent={agent} chip />
      </dd>
      <dt>{t("team.browserProfile")}</dt>
      <dd>
        <Pick
          label={t("team.browserProfile")}
          text={t(PROFILE_KEY[agent.browser_profile])}
          options={PROFILES.map((p) => ({ value: p, text: t(PROFILE_KEY[p]) }))}
          value={agent.browser_profile}
          onPick={(v) => void setAgentBrowserProfile(agent.id, v as (typeof PROFILES)[number])}
        />
      </dd>
      <dt>{t("team.autonomy")}</dt>
      <dd>
        <Pick
          label={t("team.autonomy")}
          text={agent.autonomy ? t(`team.autonomy.${agent.autonomy}`) : fromProject}
          options={[
            { value: FROM_PROJECT, text: fromProject },
            ...AUTONOMY.map((a) => ({ value: a, text: t(`team.autonomy.${a}`) })),
          ]}
          value={agent.autonomy ?? FROM_PROJECT}
          onPick={(v) =>
            void updateAgent(agent.id, { autonomy: v === FROM_PROJECT ? null : (v as (typeof AUTONOMY)[number]) })
          }
        />
      </dd>
      <dt>{t("team.budget")}</dt>
      <dd>
        <AgentBudgetField agentId={agent.id} />
      </dd>
      <AgentComputer key={agent.id} agent={agent.id} onTurnOn={() => setEditing("computer")} />
      {fromFile && (
        <>
          <dt>{t("team.file")}</dt>
          <dd className="teamdetail__mono">.apc/agents/{agent.slug}.md</dd>
        </>
      )}
    </dl>
  );

  return (
    <aside className={inPanel ? "teamdetail is-panel" : "teamdetail"} aria-label={agent.name}>
      <header className="teamdetail__head">
        <AgentAvatar name={agent.name} blob={blobOf(agent)} size={40} animated={false} />
        <div className="teamdetail__names">
          <div className="teamdetail__name">{agent.name}</div>
          <div className="teamdetail__slug">{agent.slug ?? agent.id}</div>
        </div>
        <IconButton
          size="sm"
          label={t("agent.edit.open")}
          icon={<Icons.Pencil size={14} />}
          onClick={() => setEditing("identity")}
        />
        <IconButton size="sm" label={t("common.close")} icon={<Icons.X size={14} />} onClick={onClose} />
      </header>
      {agent.role && <div className="teamdetail__role">{agent.role}</div>}
      {agent.description && <p className="teamdetail__desc">{agent.description}</p>}
      {agent.kind === "secretary" && <SuperAgentLinks />}
      <Button size="sm" leadingIcon={<Icons.MessageCircle size={14} />} onClick={onChat}>
        {t("team.chatWith", { name: agent.name })}
      </Button>

      <div className="teamdetail__stats">
        <Stat value={stats.chats} label={t("agent.stats.chats")} />
        <Stat value={stats.tasks} label={t("agent.stats.tasks")} />
        <Stat value={stats.routines} label={t("agent.stats.routines")} />
        <Stat value={stats.last ? shortWhen(stats.last) : "—"} label={t("agent.stats.last")} />
      </div>

      <Tabs
        variant="pill"
        className="teamdetail__tabs"
        value={tab}
        onValueChange={setTab}
        items={[
          { value: "summary", label: t("agent.tab.summary"), content: facts },
          {
            value: "prompt",
            label: t("agent.tab.prompt"),
            content: <AgentPrompt key={edits} agent={agent} onEdit={() => setEditing("prompt")} />,
          },
          { value: "activity", label: t("agent.tab.activity"), content: <AgentActivity agent={agent} /> },
          {
            value: "routines",
            label: t("agent.tab.routines"),
            count: routines.filter((x) => x.agent_id === agent.id).length,
            content: <AgentRoutines agent={agent} />,
          },
        ]}
      />
      {editing && (
        <AgentEditor
          agent={agent}
          start={editing}
          onClose={() => {
            setEditing(false);
            setEdits((n) => n + 1);
          }}
        />
      )}

      {pending !== undefined && (
        <Dialog
          open
          onOpenChange={(o) => !o && setPending(undefined)}
          title={t("team.parent.confirmTitle")}
          footer={
            <>
              <Button variant="secondary" onClick={() => setPending(undefined)}>
                {t("common.cancel")}
              </Button>
              <Button
                onClick={() => {
                  const to = pending;
                  setPending(undefined);
                  void setAgentParent(agent.id, to);
                }}
              >
                {t("team.parent.confirm")}
              </Button>
            </>
          }
        >
          <p className="teamdetail__confirm">
            {fromFile
              ? t("team.parent.confirmBody", {
                  name: agent.name,
                  from: nameOf(agent.parent),
                  to: nameOf(pending || undefined),
                  file: `.apc/agents/${agent.slug}.md`,
                })
              : t("team.parent.confirmBodyGlobal", {
                  name: agent.name,
                  from: nameOf(agent.parent),
                  to: nameOf(pending || undefined),
                })}
          </p>
        </Dialog>
      )}
    </aside>
  );
}

function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="teamdetail__stat">
      <span className="teamdetail__statvalue">{value}</span>
      <span className="teamdetail__statlabel">{label}</span>
    </div>
  );
}

/** A select-like button over a menu of options (the panel's pickers look the same). */
function Pick(props: {
  label: string;
  text: string;
  value: string;
  options: Array<{ value: string; text: string }>;
  onPick(value: string): void;
}) {
  return (
    <Menu
      align="start"
      items={props.options.map((o) => ({
        label: o.text,
        icon: o.value === props.value ? <Icons.Check /> : <span />,
        onSelect: () => props.onPick(o.value),
      }))}
      trigger={
        <button type="button" className="selectbtn" aria-label={props.label}>
          <span className="selectbtn__text">{props.text}</span>
          <Icons.ChevronDown size={12} />
        </button>
      }
    />
  );
}

/** What the agent is told: its own prompt, and where the rest comes from. */
function AgentPrompt({ agent, onEdit }: { agent: Agent; onEdit(): void }) {
  const t = useT();
  const [prompt, setPrompt] = useState<string>();
  useEffect(() => {
    let live = true;
    void getAgent(agent.id).then((r) => live && setPrompt(r?.prompt ?? ""));
    return () => {
      live = false;
    };
  }, [agent.id]);
  return (
    <div className="teamdetail__prompt">
      {agent.personality && (
        <p className="teamdetail__personality">
          <b>{t("agent.edit.personality")}:</b> {agent.personality}
        </p>
      )}
      {prompt === undefined ? null : prompt.trim() ? (
        <pre className="teamdetail__prompttext">{prompt}</pre>
      ) : (
        <p className="teamdetail__muted">{t("agent.prompt.empty")}</p>
      )}
      <Button size="sm" variant="secondary" leadingIcon={<Icons.Pencil size={14} />} onClick={onEdit}>
        {t("agent.prompt.edit")}
      </Button>
    </div>
  );
}

/** The super-agent's own settings live elsewhere: its profile, and who you are to it. */
function SuperAgentLinks() {
  const t = useT();
  const lang = useLanguage();
  const profile = useProfiles((s) => activeProfileName(s, lang));
  useEffect(() => {
    void loadProfiles({ quiet: true });
  }, []);
  return (
    <div className="teamdetail__super">
      <button type="button" className="teamdetail__superlink" onClick={() => go.config("profile")}>
        <Icons.Calendar size={14} />
        <span>
          {t("agent.super.profile")}: <b>{profile === undefined ? "…" : (profile ?? t("prof.none"))}</b>
        </span>
        <Icons.ChevronRight size={14} />
      </button>
      <button type="button" className="teamdetail__superlink" onClick={() => go.config("account")}>
        <Icons.User size={14} />
        <span>{t("agent.super.owner")}</span>
        <Icons.ChevronRight size={14} />
      </button>
    </div>
  );
}
