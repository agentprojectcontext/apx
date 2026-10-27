import type { Agent, Thread } from "@apx/protocol";
import { ContextMenu, ConversationRow, Icons, Spinner, Tag } from "@apx/ui";
import { CHANNEL_KINDS, type ChannelKind } from "../channels/kinds.ts";
import { ChatProcesses } from "../common/ChatProcesses.tsx";
import { shortWhen } from "../common/format.ts";
import { isWorking, routineName } from "../data/identity.ts";
import { type T, useT } from "../i18n/index.ts";
import { ThreadAvatar } from "./ThreadAvatar.tsx";
import { threadMenu } from "./threadActions.tsx";
import { useThreadChannel } from "./useThreadChannel.ts";

export type ThreadRowProps = {
  thread: Thread;
  agent: Agent | undefined;
  selected: boolean;
  onOpen: () => void;
};

export function ThreadRow({ thread, agent, selected, onOpen }: ThreadRowProps) {
  const t = useT();
  const channel = useThreadChannel(thread);
  const working = isWorking(thread.state);
  const waiting = thread.state === "input-required";
  const preview = firstLine(thread.preview) || (working ? t("thread.working") : t("thread.noMessages"));
  return (
    <ContextMenu items={threadMenu(thread, { t, agent })}>
      <ConversationRow
        className="threadrow"
        selected={selected}
        onClick={onOpen}
        avatar={<ThreadAvatar thread={thread} agent={agent} size={32} slot={36} />}
        title={
          <>
            {thread.pinned && <PinMark />}
            {thread.kind === "routine" ? routineName(thread) : thread.title}
          </>
        }
        titleTag={
          <>
            <ChatProcesses thread={thread.id} />
            {!thread.engine && agent?.kind === "secretary" && <Tag kind="role">{t("agent.super")}</Tag>}
          </>
        }
        time={shortWhen(thread.updated_at)}
        unread={thread.unread}
        meta={metaLine(thread, agent, t, channel)}
        preview={
          <span className="threadrow__preview">
            {working && <Spinner size={12} className="threadrow__spin" />}
            {waiting && <span className="threadrow__waiting">{t("thread.waiting")} · </span>}
            {preview}
          </span>
        }
      />
    </ContextMenu>
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
  if (channel) return t("chat.viaChannel", { channel: t(CHANNEL_KINDS[channel].name) });
  const kind = thread.kind === "home" ? t("thread.home") : t("thread.chat");
  return agent?.role ? `${kind} · ${agent.role}` : kind;
}

function firstLine(s: string): string {
  const line = s.split("\n").find((l) => l.trim()) ?? "";
  return line.replace(/\*\*|`|^\s*(#+|>|[-*])\s+/g, "");
}
