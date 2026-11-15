import "./GroupPart.css";
import type { Thread } from "@apx/protocol";
import { ActivityPill, AgentAvatar, Button, EmptyState, Icons } from "@apx/ui";
import { useEffect } from "react";
import { AgentTurn } from "../chat/AgentTurn.tsx";
import { Thinking } from "../chat/Thinking.tsx";
import { loadThread } from "../data/actions.ts";
import { blobOf } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { GroupCard } from "./GroupCard.tsx";
import { type GroupView, useGroupChat } from "./groupChat.ts";

/**
 * A group chat's own parts of the chat screen: its members under its name (each opens its work in the group), who
 * is answering while it works, and what an empty group says.
 */
export function GroupPart({
  part,
  thread,
  onClose,
}: {
  part: "members" | "activity" | "empty" | "card";
  thread: Thread;
  onClose?: () => void;
}) {
  if (part === "card") return <GroupCard thread={thread} onClose={onClose ?? (() => {})} />;
  return <InChat part={part} thread={thread} />;
}

function InChat({ part, thread }: { part: "members" | "activity" | "empty"; thread: Thread }) {
  const t = useT();
  const group = useGroupChat(thread);
  if (!group) return null;
  if (part === "empty")
    return (
      <EmptyState icon={<Icons.Users />} title={t("group.emptyTitle", { names: group.names })}>
        {t("group.emptyBody")}
      </EmptyState>
    );
  if (part === "activity") return <Answering group={group} />;
  return (
    <span className="chat__members">
      {group.members.map((a, i) => {
        const chat = group.chats[a.id];
        return (
          <span key={a.id}>
            <Button
              variant="link"
              size="sm"
              className="chat__member"
              {...(chat ? { title: t("group.memberChat", { name: a.name }) } : {})}
              onClick={() => (chat ? go.thread(chat) : go.agent(a.id))}
            >
              {a.name}
            </Button>
            {i < group.members.length - 1 && ","}
          </span>
        );
      })}
    </span>
  );
}

/** The member answering now: its words as it writes them, or who is about to answer. */
function Answering({ group }: { group: GroupView }) {
  const t = useT();
  const who = group.speaker;
  const chatId = who ? group.chats[who.id] : undefined;
  const chat = useData((s) => (chatId ? s.threads[chatId] : undefined));
  const loaded = useData((s) => (chatId ? s.messages[chatId] !== undefined : false));
  const last = useData((s) => (chatId ? s.messages[chatId]?.at(-1) : undefined));
  // Its chat is read once it starts, so what it writes arrives here as it goes.
  useEffect(() => {
    if (chatId && !loaded) void loadThread(chatId);
  }, [chatId, loaded]);
  const writing = last?.author.kind === "agent" && last.parts.some((p) => p.type === "text" && p.text.trim());
  if (who && chat && last && writing)
    return (
      <div className="transcript__row">
        <AgentTurn
          thread={chat}
          message={last}
          agent={who}
          showAvatar
          showTools={false}
          showSkills={false}
          showPlan={false}
        />
      </div>
    );
  // The member at work, before it writes: how long, and what it is thinking when its model says.
  if (who && chatId)
    return (
      <Thinking threadId={chatId} name={who.name} face={<AgentAvatar name={who.name} blob={blobOf(who)} size={22} />} />
    );
  return (
    <div className="transcript__activity">
      <ActivityPill tone="brand" label={t("group.picking")} />
    </div>
  );
}
