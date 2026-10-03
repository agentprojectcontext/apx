import type { Agent, Thread } from "@apx/protocol";
import { AgentAvatar, ConversationRow, EngineIcon, Spinner, Tag } from "@apx/ui";
import { CHANNEL_KINDS, isChannelKind } from "../channels/kinds.ts";
import { shortWhen } from "../common/format.ts";
import { blobOf, isWorking } from "../data/identity.ts";
import { type T, useT } from "../i18n/index.ts";

export type ThreadRowProps = {
  thread: Thread;
  agent: Agent | undefined;
  selected: boolean;
  onOpen: () => void;
};

export function ThreadRow({ thread, agent, selected, onOpen }: ThreadRowProps) {
  const t = useT();
  const working = isWorking(thread.state);
  const waiting = thread.state === "input-required";
  const preview = firstLine(thread.preview) || (working ? t("thread.working") : t("thread.noMessages"));
  return (
    <ConversationRow
      selected={selected}
      onClick={onOpen}
      avatar={
        thread.engine ? (
          <EngineIcon engine={thread.engine} tile size={36} />
        ) : (
          <AgentAvatar name={agent?.name ?? thread.title} blob={blobOf(agent)} size={36} animated={false} />
        )
      }
      title={thread.title}
      titleTag={!thread.engine && agent?.kind === "secretary" ? <Tag kind="role">{t("agent.super")}</Tag> : undefined}
      time={shortWhen(thread.updated_at)}
      unread={thread.unread}
      meta={metaLine(thread, agent, t)}
      preview={
        <span className="threadrow__preview">
          {working && <Spinner size={12} className="threadrow__spin" />}
          {waiting && <span className="threadrow__waiting">{t("thread.waiting")} · </span>}
          {preview}
        </span>
      }
    />
  );
}

/** Third line: what kind of chat this is, and the agent's role when it has one (an engine session: its folder). */
function metaLine(thread: Thread, agent: Agent | undefined, t: T): string {
  if (thread.engine) return `${t("engine.direct")} · ${thread.cwd?.split("/").filter(Boolean).at(-1) ?? ""}`;
  if (thread.kind === "a2a") return t("thread.a2a");
  if (thread.kind === "group") return t("thread.group", { n: thread.agent_ids.length });
  const via = thread.channel?.id ?? "";
  if (isChannelKind(via)) return t("chat.viaChannel", { channel: t(CHANNEL_KINDS[via].name) });
  const kind = thread.kind === "home" ? t("thread.home") : t("thread.chat");
  return agent?.role ? `${kind} · ${agent.role}` : kind;
}

function firstLine(s: string): string {
  const line = s.split("\n").find((l) => l.trim()) ?? "";
  return line.replace(/\*\*|`|^\s*(#+|>|[-*])\s+/g, "");
}
