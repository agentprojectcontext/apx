import type { Agent, Thread } from "@apx/protocol";
import { ContextMenu, ConversationRow, IconButton, Icons, Spinner } from "@apx/ui";
import { CHANNEL_KINDS, type ChannelKind } from "../channels/kinds.ts";
import { ChatProcesses } from "../common/ChatProcesses.tsx";
import { shortWhen } from "../common/format.ts";
import { isWorking, projectName, routineName } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { updateThread } from "../data/threadAdmin.ts";
import { type T, useT } from "../i18n/index.ts";
import { useNav } from "../shell/nav.ts";
import { ProjectBadge } from "./ProjectBadge.tsx";
import { ThreadAvatar } from "./ThreadAvatar.tsx";
import { lockedBy, threadMenu } from "./threadActions.tsx";
import { useThreadChannel } from "./useThreadChannel.ts";

export type ThreadRowProps = {
  thread: Thread;
  agent: Agent | undefined;
  selected: boolean;
  onOpen: () => void;
};

/**
 * A chat in a list, two lines: its title, its project (outside the project) and when; then who and what kind of chat.
 * Resting on it shows pin and archive; the rest is in its menu.
 */
export function ThreadRow({ thread, agent, selected, onOpen }: ThreadRowProps) {
  const t = useT();
  const channel = useThreadChannel(thread);
  const projects = useData((s) => s.projects);
  const inProject = useNav((s) => s.view === "project");
  const working = isWorking(thread.state);
  const waiting = thread.state === "input-required";
  const locked = lockedBy(thread, t);
  const who = agent?.name ?? (thread.engine ? "" : thread.title);
  return (
    <div className="threadrow-wrap">
      <ContextMenu items={threadMenu(thread, { t, agent })}>
        <ConversationRow
          className="threadrow"
          selected={selected}
          onClick={onOpen}
          avatar={<ThreadAvatar thread={thread} agent={agent} size={24} slot={28} />}
          title={thread.kind === "routine" ? routineName(thread) : thread.title}
          titleTag={
            <>
              <ChatProcesses thread={thread.id} />
              {!inProject && thread.project_id && (
                <ProjectBadge id={thread.project_id} name={projectName(projects, thread.project_id)} />
              )}
              {working && <Spinner size={12} className="threadrow__spin" />}
            </>
          }
          time={shortWhen(thread.updated_at)}
          unread={thread.unread}
          preview={
            <span className="threadrow__preview">
              {waiting && <span className="threadrow__waiting">{t("thread.waiting")} · </span>}
              {[who, metaLine(thread, agent, t, channel)].filter(Boolean).join(" · ")}
            </span>
          }
        />
      </ContextMenu>
      <span className="threadrow__actions">
        <IconButton
          size="sm"
          label={thread.pinned ? t("thread.menu.unpin") : t("thread.menu.pin")}
          active={thread.pinned}
          icon={<Icons.Pin size={14} />}
          onClick={() => void updateThread(thread.id, { pinned: !thread.pinned })}
        />
        {!locked && (
          <IconButton
            size="sm"
            label={thread.archived ? t("thread.menu.unarchive") : t("thread.menu.archive")}
            icon={thread.archived ? <Icons.ArchiveRestore size={14} /> : <Icons.Archive size={14} />}
            onClick={() => void updateThread(thread.id, { archived: !thread.archived })}
          />
        )}
      </span>
    </div>
  );
}

/** The mark of a chat the owner pinned on top of its group. */
export function PinMark() {
  const t = useT();
  return (
    <span className="threadrow__pin" role="img" aria-label={t("thread.pinned")}>
      <Icons.Pin size={11} />
    </span>
  );
}

/** Third line: what kind of chat this is, and the agent's role when it has one (an engine session: its folder). */
function metaLine(thread: Thread, agent: Agent | undefined, t: T, channel: ChannelKind | undefined): string {
  if (thread.engine) return `${t("engine.direct")} · ${thread.cwd?.split("/").filter(Boolean).at(-1) ?? ""}`;
  if (thread.kind === "a2a") return t("thread.a2a");
  if (thread.kind === "group") return t("thread.group", { n: thread.agent_ids.length });
  if (thread.kind === "routine") return t("thread.routineOf", { name: routineName(thread) });
  if (thread.flow) return t("thread.flowStep");
  if (channel) return t("chat.viaChannel", { channel: t(CHANNEL_KINDS[channel].name) });
  const kind = thread.kind === "home" ? t("thread.home") : t("thread.chat");
  return agent?.role ? `${kind} · ${agent.role}` : kind;
}
