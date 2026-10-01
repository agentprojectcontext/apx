import type { Agent, Thread } from "@apx/protocol";
import { AgentAvatar, ConversationRow, Spinner, Tag } from "@apx/ui";
import { shortWhen } from "../common/format.ts";
import { blobOf, isWorking } from "../data/identity.ts";

export type ThreadRowProps = {
  thread: Thread;
  agent: Agent | undefined;
  selected: boolean;
  onOpen: () => void;
};

export function ThreadRow({ thread, agent, selected, onOpen }: ThreadRowProps) {
  const working = isWorking(thread.state);
  const waiting = thread.state === "input-required";
  const preview = firstLine(thread.preview) || (working ? "Trabajando…" : "Sin mensajes todavía");
  return (
    <ConversationRow
      selected={selected}
      onClick={onOpen}
      avatar={<AgentAvatar name={agent?.name ?? thread.title} blob={blobOf(agent)} size={36} animated={false} />}
      title={thread.title}
      titleTag={agent?.kind === "secretary" ? <Tag kind="role">Super-agente</Tag> : undefined}
      time={shortWhen(thread.updated_at)}
      unread={thread.unread}
      meta={metaLine(thread, agent)}
      preview={
        <span className="threadrow__preview">
          {working && <Spinner size={12} className="threadrow__spin" />}
          {waiting && <span className="threadrow__waiting">Te espera · </span>}
          {preview}
        </span>
      }
    />
  );
}

/** Third line: what kind of chat this is, and the agent's role when it has one. */
function metaLine(thread: Thread, agent: Agent | undefined): string {
  if (thread.kind === "a2a") return "Agente ↔ agente";
  if (thread.kind === "group") return `Grupo · ${thread.agent_ids.length} agentes`;
  const kind = thread.kind === "home" ? "Chat principal" : "Chat";
  return agent?.role ? `${kind} · ${agent.role}` : kind;
}

function firstLine(s: string): string {
  const line = s.split("\n").find((l) => l.trim()) ?? "";
  return line.replace(/\*\*|`|^\s*(#+|>|[-*])\s+/g, "");
}
