import type { Agent, Thread } from "@apx/protocol";
import { AgentAvatar, ContextMenu, EngineIcon, Icons, ProjectTile, Spinner, Tooltip } from "@apx/ui";
import { useState } from "react";
import { KindIcon } from "../channels/KindIcon.tsx";
import { CHANNEL_KINDS, isChannelKind } from "../channels/kinds.ts";
import { shortWhen } from "../common/format.ts";
import { useEngineLabel } from "../common/useEngineLabel.ts";
import {
  blobOf,
  DEFAULT_PID,
  isWorking,
  projectInitial,
  projectName,
  projectTone,
  routineName,
} from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import type { ActivityGroup, ProjectTree, TimeBucket } from "./groupThreads.ts";
import { PinMark } from "./ThreadRow.tsx";
import { threadMenu } from "./threadActions.tsx";

/**
 * A chat's name for a list: its title, or what was said last when the title only repeats the agent's name. A routine
 * run's is what it told (its routine shows by its mark).
 */
export function chatLabel(thread: Thread, agent: Agent | undefined, generic: string): string {
  const plain = !thread.title || thread.title === agent?.name || thread.title === generic || thread.kind === "routine";
  const said = thread.preview.split("\n").find((l) => l.trim()) ?? "";
  return plain && said ? said.replace(/\*\*|`|^\s*(#+|>|[-*])\s+/g, "") : thread.title;
}

const cx = (...c: Array<string | false>) => c.filter(Boolean).join(" ");

/** Chats shown per agent before "N more". */
const PER_AGENT = 3;

const BUCKET: Record<TimeBucket, MessageKey> = {
  pinned: "inbox.when.pinned",
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
  const threads = useData((s) => s.threads);
  const engines = useData((s) => s.engines);
  const engineLabel = (id: string) => engines.find((e) => e.id === id)?.label ?? id;
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
            const agent = b.engine ? undefined : agents[b.agentId];
            const key = `${tree.key}:${b.agentId}`;
            const all = open[key] ?? false;
            const shown = all ? b.threads : b.threads.slice(0, PER_AGENT);
            // The super-agent's name opens Home (the chat in common); another agent's, its latest chat; an
            // engine's, its sessions.
            const openBranch = () =>
              b.engine
                ? go.engine(b.engine)
                : agent?.kind === "secretary" && threads.home
                  ? go.thread("home")
                  : b.threads[0] && go.thread(b.threads[0].id);
            return (
              <div key={key} className="tree__agent">
                <button type="button" className="tree__agenthead" onClick={openBranch}>
                  {b.engine ? (
                    <EngineIcon engine={b.engine} tile size={20} />
                  ) : (
                    <AgentAvatar name={agent?.name ?? b.agentId} blob={blobOf(agent)} size={20} animated={false} />
                  )}
                  <span className="tree__agentname">
                    {b.engine ? engineLabel(b.engine) : (agent?.name ?? b.agentId)}
                  </span>
                  <span className="tree__agentmeta">
                    {t(b.engine ? "nav.externalSession" : agent?.kind === "secretary" ? "agent.super" : "common.agent")}{" "}
                    · {b.threads.length}
                  </span>
                </button>
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
    <ContextMenu items={threadMenu(thread, { t, agent })}>
      <button
        type="button"
        className={cx("tree__session", selected && "is-selected", thread.unread > 0 && "is-unread")}
        onClick={() => go.thread(thread.id)}
      >
        {isWorking(thread.state) && <Spinner size={12} />}
        {thread.state === "input-required" && <Icons.Hand size={12} className="tree__waiting" />}
        {thread.pinned && <PinMark />}
        <ChannelMark thread={thread} />
        <RoutineMark thread={thread} />
        <span className="tree__sessiontitle">{chatLabel(thread, agent, t("chat.new"))}</span>
        <CodeMark thread={thread} />
        {thread.unread > 0 && <span className="tree__unread">{thread.unread}</span>}
        <span className="tree__when">{shortWhen(thread.updated_at)}</span>
      </button>
    </ContextMenu>
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
              <ContextMenu key={th.id} items={threadMenu(th, { t, agent })}>
                <button
                  type="button"
                  className={cx("activity__row", th.id === selected && "is-selected", th.unread > 0 && "is-unread")}
                  onClick={() => go.thread(th.id)}
                >
                  {th.engine ? (
                    <EngineIcon engine={th.engine} tile size={28} />
                  ) : (
                    <AgentAvatar name={agent?.name ?? th.title} blob={blobOf(agent)} size={28} animated={false} />
                  )}
                  <span className="activity__body">
                    <span className="activity__title">
                      {isWorking(th.state) && <Spinner size={12} />}
                      {th.state === "input-required" && <Icons.Hand size={12} className="tree__waiting" />}
                      {th.pinned && <PinMark />}
                      <RoutineMark thread={th} />
                      <span className="activity__text">{chatLabel(th, agent, t("chat.new"))}</span>
                    </span>
                    <span className="activity__meta">
                      <ProjectTile tone={projectTone(th.project_id ?? DEFAULT_PID)} size={10} />
                      {projectName(projects, th.project_id)} · <Where thread={th} agent={agent} />
                      <CodeMark thread={th} />
                    </span>
                  </span>
                  <span className="activity__side">
                    <span className="tree__when">{shortWhen(th.updated_at)}</span>
                    {th.unread > 0 && <span className="tree__unread">{th.unread}</span>}
                  </span>
                </button>
              </ContextMenu>
            );
          })}
        </div>
      ))}
    </>
  );
}

/** A chat that came in on a channel: that channel's logo before its name. */
function ChannelMark({ thread }: { thread: Thread }) {
  const via = thread.channel?.id ?? "";
  return isChannelKind(via) ? <KindIcon kind={via} size={12} /> : null;
}

/** A routine's run: a clock, and the routine's name on hover. */
export function RoutineMark({ thread }: { thread: Thread }) {
  const t = useT();
  if (thread.kind !== "routine") return null;
  const name = routineName(thread);
  return (
    <Tooltip content={t("thread.routineHint", { name })}>
      <span className="tree__routine" role="img" aria-label={t("thread.routine")}>
        <Icons.Clock size={12} />
      </span>
    </Tooltip>
  );
}

/** Who a chat is with, for its context line: the channel it runs on, the engine, or the agent. */
function Where({ thread, agent }: { thread: Thread; agent: Agent | undefined }) {
  const t = useT();
  const engine = useEngineLabel(thread.engine);
  const via = thread.channel?.id ?? "";
  if (thread.kind === "routine") return <>{t("thread.routineOf", { name: routineName(thread) })}</>;
  if (isChannelKind(via))
    return (
      <span className="activity__via">
        <KindIcon kind={via} size={10} /> {t("chat.viaChannel", { channel: t(CHANNEL_KINDS[via].name) })}
      </span>
    );
  return <>{engine ?? agent?.name ?? "—"}</>;
}

/** A coding session (the agent works inside a folder: reads, edits, runs): a folder mark that says where. */
function CodeMark({ thread }: { thread: Thread }) {
  const t = useT();
  if (thread.kind !== "code") return null;
  const folder = thread.cwd?.split("/").filter(Boolean).at(-1) ?? "";
  return (
    <Tooltip content={t("thread.codeHint", { folder })}>
      <span className="tree__code" role="img" aria-label={t("thread.code")}>
        <Icons.FolderCode size={12} />
      </span>
    </Tooltip>
  );
}
