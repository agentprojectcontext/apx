import type { Agent, Thread } from "@apx/protocol";
import { AgentAvatar, Icons, ProjectTile, Spinner, Tag } from "@apx/ui";
import { useState } from "react";
import { shortWhen } from "../common/format.ts";
import { blobOf, DEFAULT_PID, isWorking, projectInitial, projectName, projectTone } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import type { ActivityGroup, ProjectTree, TimeBucket } from "./groupThreads.ts";

/** A chat's name for a list: its title, or what was said last when the title only repeats the agent's name. */
export function chatLabel(thread: Thread, agent: Agent | undefined, generic: string): string {
  const plain = !thread.title || thread.title === agent?.name || thread.title === generic;
  const said = thread.preview.split("\n").find((l) => l.trim()) ?? "";
  return plain && said ? said.replace(/\*\*|`|^\s*(#+|>|[-*])\s+/g, "") : thread.title;
}

/** Chats shown per agent before "N more". */
const PER_AGENT = 3;

const BUCKET: Record<TimeBucket, MessageKey> = {
  running: "inbox.when.running",
  today: "inbox.when.today",
  yesterday: "inbox.when.yesterday",
  week: "inbox.when.week",
  earlier: "inbox.when.earlier",
};

/** 1b · Tree: project → agent → chats. Everything explicit, one click away. */
export function TreeView({ trees, selected }: { trees: ProjectTree[]; selected: string | undefined }) {
  const t = useT();
  const agents = useData((s) => s.agents);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <>
      {trees.map((tree) => (
        <div key={tree.key} className="tree__project">
          <div className="tree__projecthead">
            <ProjectTile
              tone={projectTone(tree.project?.id ?? DEFAULT_PID)}
              initial={projectInitial(tree.name)}
              size={16}
            />
            <span>{tree.name}</span>
          </div>
          {tree.agents.map((b) => {
            const agent = agents[b.agentId];
            const key = `${tree.key}:${b.agentId}`;
            const all = open[key] ?? false;
            const shown = all ? b.threads : b.threads.slice(0, PER_AGENT);
            return (
              <div key={key} className="tree__agent">
                <div className="tree__agenthead">
                  <AgentAvatar name={agent?.name ?? b.agentId} blob={blobOf(agent)} size={20} animated={false} />
                  <span className="tree__agentname">{agent?.name ?? b.agentId}</span>
                  <span className="tree__agentmeta">
                    {t(agent?.kind === "secretary" ? "agent.super" : "common.agent")} · {b.threads.length}
                  </span>
                </div>
                <div className="tree__sessions">
                  {shown.map((th) => (
                    <SessionRow key={th.id} thread={th} agent={agent} selected={th.id === selected} />
                  ))}
                  {b.threads.length > PER_AGENT && (
                    <button
                      type="button"
                      className="tree__more"
                      onClick={() => setOpen((o) => ({ ...o, [key]: !all }))}
                    >
                      {all ? t("inbox.showLess") : t("inbox.showMore", { n: b.threads.length - PER_AGENT })}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

function SessionRow({ thread, agent, selected }: { thread: Thread; agent: Agent | undefined; selected: boolean }) {
  const t = useT();
  return (
    <button
      type="button"
      className={selected ? "tree__session is-selected" : "tree__session"}
      onClick={() => go.thread(thread.id)}
    >
      {isWorking(thread.state) && <Spinner size={12} />}
      {thread.state === "input-required" && <Icons.Hand size={12} className="tree__waiting" />}
      <span className="tree__sessiontitle">{chatLabel(thread, agent, t("chat.new"))}</span>
      {thread.kind === "code" && <Tag>{t("thread.code")}</Tag>}
      {thread.unread > 0 && <span className="tree__unread">{thread.unread}</span>}
      <span className="tree__when">{shortWhen(thread.updated_at)}</span>
    </button>
  );
}

/** 1c · Activity: chats by time, with what runs now on top; project and agent as each row's context. */
export function ActivityView({ groups, selected }: { groups: ActivityGroup[]; selected: string | undefined }) {
  const t = useT();
  const agents = useData((s) => s.agents);
  const projects = useData((s) => s.projects);
  return (
    <>
      {groups.map((g) => (
        <div key={g.bucket} className="activity__group">
          <div className="activity__label">{t(BUCKET[g.bucket])}</div>
          {g.threads.map((th) => {
            const agent: Agent | undefined = agents[th.agent_ids[0] ?? ""];
            return (
              <button
                key={th.id}
                type="button"
                className={th.id === selected ? "activity__row is-selected" : "activity__row"}
                onClick={() => go.thread(th.id)}
              >
                <AgentAvatar name={agent?.name ?? th.title} blob={blobOf(agent)} size={28} animated={false} />
                <span className="activity__body">
                  <span className="activity__title">
                    {isWorking(th.state) && <Spinner size={12} />}
                    {th.state === "input-required" && <Icons.Hand size={12} className="tree__waiting" />}
                    <span className="activity__text">{chatLabel(th, agent, t("chat.new"))}</span>
                  </span>
                  <span className="activity__meta">
                    <ProjectTile tone={projectTone(th.project_id ?? DEFAULT_PID)} size={10} />
                    {projectName(projects, th.project_id)} · {agent?.name ?? "—"}
                    {th.kind === "code" ? ` · ${t("thread.code")}` : ""}
                  </span>
                </span>
                <span className="activity__side">
                  <span className="tree__when">{shortWhen(th.updated_at)}</span>
                  {th.unread > 0 && <span className="tree__unread">{th.unread}</span>}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </>
  );
}
