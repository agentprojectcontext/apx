import type { Agent, Thread } from "@apx/protocol";
import { ContextMenu, ConversationRow, IconButton, Icons, Menu, Spinner } from "@apx/ui";
import { CHANNEL_KINDS, type ChannelKind } from "../channels/kinds.ts";
import { ChatProcesses } from "../common/ChatProcesses.tsx";
import { shortWhen } from "../common/format.ts";
import { useEngineLabel } from "../common/useEngineLabel.ts";
import { isWorking, projectName, routineName } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { type T, useT } from "../i18n/index.ts";
import { useNav } from "../shell/nav.ts";
import { ProjectBadge } from "./ProjectBadge.tsx";
import { useRowFold } from "./RowFold.tsx";
import { ThreadAvatar } from "./ThreadAvatar.tsx";
import { threadMenu } from "./threadActions.tsx";
import { useThreadChannel } from "./useThreadChannel.ts";

export type ThreadRowProps = {
  thread: Thread;
  agent: Agent | undefined;
  selected: boolean;
  onOpen: () => void;
};

/**
 * A chat in a list, two lines: its title (with the chevron of its nested sessions) and when; then who speaks in it,
 * where, and its project (outside the project). Resting on it shows pin and archive; the rest is in its menu.
 */
export function ThreadRow({ thread, agent, selected, onOpen }: ThreadRowProps) {
  const t = useT();
  const channel = useThreadChannel(thread);
  const engine = useEngineLabel(thread.engine);
  const projects = useData((s) => s.projects);
  const inProject = useNav((s) => s.view === "project");
  const fold = useRowFold();
  const working = isWorking(thread.state);
  const waiting = thread.state === "input-required";
  const who = engine ?? agent?.name ?? thread.title;
  return (
    <div className="threadrow-wrap" ref={fold.wrap}>
      <ContextMenu items={threadMenu(thread, { t, agent })}>
        <ConversationRow
          className="threadrow"
          selected={selected}
          onClick={onOpen}
          avatar={<ThreadAvatar thread={thread} agent={agent} size={24} slot={28} />}
          title={thread.kind === "routine" ? routineName(thread) : thread.title}
          titleTag={
            <>
              {fold.slot}
              <ChatProcesses thread={thread.id} />
              {working && <Spinner size={12} className="threadrow__spin" />}
            </>
          }
          time={shortWhen(thread.updated_at)}
          unread={thread.unread}
          preview={
            <span className="threadrow__line">
              <span className="threadrow__who">
                {waiting && <span className="threadrow__waiting">{t("thread.waiting")} · </span>}
                {[who, contextOf(thread, agent, t, channel)].filter(Boolean).join(" · ")}
              </span>
              {!inProject && thread.project_id && (
                <>
                  <span className="threadrow__dot">·</span>
                  <ProjectBadge
                    id={thread.project_id}
                    name={projectName(projects, thread.project_id)}
                    channel={channel}
                  />
                </>
              )}
            </span>
          }
        />
      </ContextMenu>
      {fold.button}
      {/* Pointed at, "···" takes the time's place: the row's whole menu, the fold beside the title left free. */}
      <span className="threadrow__more">
        <Menu
          align="end"
          trigger={<IconButton size="sm" label={t("chat.more")} icon={<Icons.Ellipsis size={14} />} />}
          items={threadMenu(thread, { t, agent })}
        />
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

/**
 * Where the chat happens, after who speaks in it: the channel's app for a contact's chat, "External session" for an
 * engine's, the group's name for a group, and otherwise the agent's role (or what kind of chat it is).
 */
function contextOf(thread: Thread, agent: Agent | undefined, t: T, channel: ChannelKind | undefined): string {
  if (thread.engine) return t("nav.externalSession");
  if (channel) return t(CHANNEL_KINDS[channel].name);
  if (thread.kind === "group") return thread.title;
  if (thread.kind === "a2a") return t("thread.a2a");
  if (thread.kind === "routine") return t("thread.routineOf", { name: routineName(thread) });
  if (thread.flow) return t("thread.flowStep");
  return agent?.role || (thread.kind === "home" ? t("thread.home") : t("thread.chat"));
}
