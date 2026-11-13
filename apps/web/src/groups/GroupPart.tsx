import "./GroupPart.css";
import type { Thread } from "@apx/protocol";
import { ActivityPill, AgentAvatar, Button, EmptyState, Icons } from "@apx/ui";
import { blobOf } from "../data/identity.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { useGroupChat } from "./groupChat.ts";

/**
 * A group chat's own parts of the chat screen: its members under its name (each opens its work in the group), who
 * is answering while it works, and what an empty group says.
 */
export function GroupPart({ part, thread }: { part: "members" | "activity" | "empty"; thread: Thread }) {
  const t = useT();
  const group = useGroupChat(thread);
  if (!group) return null;
  if (part === "empty")
    return (
      <EmptyState icon={<Icons.Users />} title={t("group.emptyTitle", { names: group.names })}>
        {t("group.emptyBody")}
      </EmptyState>
    );
  if (part === "activity") {
    const who = group.speaker;
    return (
      <div className="transcript__activity">
        <ActivityPill
          tone="brand"
          label={who ? t("group.answering", { name: who.name }) : t("group.picking")}
          from={who && <AgentAvatar name={who.name} blob={blobOf(who)} size={22} />}
        />
      </div>
    );
  }
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
