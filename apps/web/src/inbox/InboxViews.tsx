import type { Agent, Thread } from "@apx/protocol";
import { AgentAvatar, ContextMenu, EngineIcon, Icons, ProjectTile, Spinner, Tooltip } from "@apx/ui";
import { Suspense, useRef, useState } from "react";
import { KindIcon } from "../channels/KindIcon.tsx";
import { CHANNEL_KINDS } from "../channels/kinds.ts";
import { AgentFace } from "../common/AgentFace.tsx";
import { ChatProcesses } from "../common/ChatProcesses.tsx";
import { shortWhen } from "../common/format.ts";
import { useEngineLabel } from "../common/useEngineLabel.ts";
import { DEFAULT_PID, isWorking, projectInitial, projectTone, routineName, threadAgent } from "../data/identity.ts";
import { useData, useShownAgents } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { ChannelTreeRow, TaskBundle } from "../lazy.ts";
import { go } from "../shell/nav.ts";
import { ListedChat } from "./Delegated.tsx";
import type { ProjectTree } from "./groupThreads.ts";
import { RoutineBundle } from "./RoutineBundle.tsx";
import { ThreadAvatar } from "./ThreadAvatar.tsx";
import { PinMark } from "./ThreadRow.tsx";
import { threadMenu } from "./threadActions.tsx";
import { useThreadChannel } from "./useThreadChannel.ts";

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

/** 1b · Tree: project → agent → chats. Everything explicit, one click away. */
export function TreeView({ trees, selected }: { trees: ProjectTree[]; selected: string | undefined }) {
  const t = useT();
  const agents = useShownAgents();
  const threads = useData((s) => s.threads);
  const engines = useData((s) => s.engines);
  const engineLabel = (id: string) => engines.find((e) => e.id === id)?.label ?? id;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // Unread chats repeat on top: in the tree they can sit under "N more". One opened while unread stays while it is
  // open, read by then, so the row clicked does not jump away; a chat already open that gets an answer does not.
  const listed = [
    ...new Map(trees.flatMap((tr) => tr.agents.flatMap((b) => b.threads)).map((th) => [th.id, th])).values(),
  ];
  const opened = useRef<{ selected: string | undefined; kept: string | undefined }>({ selected, kept: undefined });
  if (opened.current.selected !== selected) {
    const wasUnread = listed.some((th) => th.id === selected && th.unread > 0);
    opened.current = { selected, kept: wasUnread ? selected : undefined };
  }
  const unread = listed
    .filter((th) => th.kind !== "routine" && (th.unread > 0 || th.id === opened.current.kept))
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  const unreadCount = unread.filter((th) => th.unread > 0).length;
  return (
    <>
      {unread.length > 0 && (
        <div className="tree__project">
          <div className="tree__projecthead">
            <span className="tree__unreaddot" />
            <span>{t("inbox.unread")}</span>
            {unreadCount > 0 && <span className="tree__agentmeta">{unreadCount}</span>}
          </div>
          <div className="tree__unreadlist">
            {unread.map((th) => (
              <SessionRow
                key={th.id}
                thread={th}
                agent={threadAgent(th, agents)}
                selected={th.id === selected}
                withAgent
              />
            ))}
          </div>
        </div>
      )}
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
            if (b.routine)
              return (
                <RoutineBundle
                  key={`${tree.key}:${b.agentId}`}
                  routineId={b.routine}
                  threads={b.threads}
                  selected={selected}
                />
              );
            if (b.task)
              return (
                <Suspense key={`${tree.key}:${b.agentId}`} fallback={null}>
                  <TaskBundle taskId={b.task} threads={b.threads} selected={selected} />
                </Suspense>
              );
            if (b.channel)
              return b.threads.map((th) => (
                <ListedChat key={th.id} thread={th} selected={selected}>
                  <Suspense
                    fallback={<SessionRow thread={th} agent={threadAgent(th, agents)} selected={th.id === selected} />}
                  >
                    <ChannelTreeRow thread={th} agent={threadAgent(th, agents)} selected={th.id === selected} />
                  </Suspense>
                </ListedChat>
              ));
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
                  ) : agent ? (
                    <AgentFace agent={agent} size={20} />
                  ) : (
                    <AgentAvatar name={b.agentId} size={20} animated={false} />
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
                    <ListedChat key={th.id} thread={th} selected={selected}>
                      <SessionRow thread={th} agent={agent} selected={th.id === selected} />
                    </ListedChat>
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

/**
 * A chat in a branch; `withAgent` names its agent first (a task's chats are several agents'), `label` replaces its
 * name.
 */
export function SessionRow({
  thread,
  agent,
  selected,
  withAgent = false,
  label,
}: {
  thread: Thread;
  agent: Agent | undefined;
  selected: boolean;
  withAgent?: boolean;
  label?: string | undefined;
}) {
  const t = useT();
  const engine = useEngineLabel(thread.engine);
  const channel = useThreadChannel(thread);
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
        <RoutineMark thread={thread} />
        {/* An engine session is the engine's (Claude Code, Codex), not the agent's that hosts it. */}
        <ThreadAvatar thread={thread} agent={agent} size={14} slot={16} />
        {withAgent && !thread.channel && (
          <span className="tree__sessionwho">{engine ?? agent?.name ?? thread.agent_ids[0]}</span>
        )}
        {/* Under its task, a chat's title only repeats the task's: what was said last tells them apart. */}
        <span className="tree__sessiontitle">
          {label ?? chatLabel(thread, agent, withAgent ? thread.title : t("chat.new"))}
        </span>
        {channel && (
          <span className="tree__agentmeta">
            <Where thread={thread} agent={agent} />
          </span>
        )}
        <CodeMark thread={thread} />
        <ChatProcesses thread={thread.id} />
        {thread.unread > 0 && <span className="tree__unread">{thread.unread}</span>}
        <span className="tree__when">{shortWhen(thread.updated_at)}</span>
      </button>
    </ContextMenu>
  );
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
export function Where({ thread, agent }: { thread: Thread; agent: Agent | undefined }) {
  const t = useT();
  const engine = useEngineLabel(thread.engine);
  const via = useThreadChannel(thread);
  if (thread.kind === "routine") return <>{t("thread.routineOf", { name: routineName(thread) })}</>;
  if (via)
    return (
      <span className="activity__via">
        <KindIcon kind={via} size={10} /> {t("chat.viaChannel", { channel: t(CHANNEL_KINDS[via].name) })}
      </span>
    );
  return <>{engine ?? agent?.name ?? "—"}</>;
}

/** A coding session (the agent works inside a folder: reads, edits, runs): a folder mark that says where. */
export function CodeMark({ thread }: { thread: Thread }) {
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
