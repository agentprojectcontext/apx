import type { Agent, Thread } from "@apx/protocol";
import { ContextMenu, Icons, Spinner } from "@apx/ui";
import { KindIcon } from "../channels/KindIcon.tsx";
import { CHANNEL_KINDS } from "../channels/kinds.ts";
import { ChatProcesses } from "../common/ChatProcesses.tsx";
import { shortWhen } from "../common/format.ts";
import { isWorking } from "../data/identity.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { chatLabel } from "./InboxViews.tsx";
import { ThreadAvatar } from "./ThreadAvatar.tsx";
import { PinMark } from "./ThreadRow.tsx";
import { threadMenu } from "./threadActions.tsx";
import { useThreadChannel } from "./useThreadChannel.ts";

export function ChannelTreeRow({
  thread,
  agent,
  selected,
}: {
  thread: Thread;
  agent: Agent | undefined;
  selected: boolean;
}) {
  const t = useT();
  const channel = useThreadChannel(thread);
  return (
    <ContextMenu items={threadMenu(thread, { t, agent })}>
      <button
        type="button"
        className={["tree__agenthead", "tree__channel", selected && "is-selected", thread.unread > 0 && "is-unread"]
          .filter(Boolean)
          .join(" ")}
        onClick={() => go.thread(thread.id)}
      >
        <ThreadAvatar thread={thread} agent={agent} size={20} />
        <span className="tree__agentname">{chatLabel(thread, agent, t("chat.new"))}</span>
        {channel && (
          <span className="tree__agentmeta activity__via">
            <KindIcon kind={channel} size={10} /> {t("chat.viaChannel", { channel: t(CHANNEL_KINDS[channel].name) })}
          </span>
        )}
        {isWorking(thread.state) && <Spinner size={12} />}
        {thread.state === "input-required" && <Icons.Hand size={12} className="tree__waiting" />}
        {thread.pinned && <PinMark />}
        <ChatProcesses thread={thread.id} />
        {thread.unread > 0 && <span className="tree__unread">{thread.unread}</span>}
        <span className="tree__when">{shortWhen(thread.updated_at)}</span>
      </button>
    </ContextMenu>
  );
}
