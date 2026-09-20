import useSWR from "swr";
import { Milestones, type Timeline } from "../lib/api/milestones";
import type { ChatKey } from "../components/chat/ChatList";

// The timeline of whatever chat is open.
//
// A chat is one of three things and they live in different stores — a project
// agent's conversation FILE, a super-agent/group/a2a LEDGER thread, or an
// agent's "live" chat, which is the newest conversation file and only has an id
// once a turn has been sent. The daemon has a route per shape because the
// stores are genuinely different; this picks between them so no screen has to
// know that.
//
// WHY IT IS FETCHED AND NOT COMPUTED IN THE BROWSER. Every number here comes
// from reading turns and counting outcomes, which the client could do — it
// already has the messages. It would also be the second implementation of that
// reading, drifting from the one in core the moment either changes. The rail is
// a few hundred bytes and it refreshes when the turn ends; the round trip is
// cheaper than the divergence.

/** Refetch when a turn finishes, not while it streams — a rail that renumbers
 *  itself mid-answer is harder to read than one that lands once. */
export function useMilestones(pid: string, selected: ChatKey, conversationId?: string | null, streaming?: boolean) {
  const target =
    selected.kind === "thread"
      ? { kind: "thread" as const, channel: selected.channel, id: selected.threadId }
      : selected.kind === "conv"
        ? { kind: "conv" as const, agent: selected.agentSlug, id: selected.convId }
        : conversationId
          ? { kind: "conv" as const, agent: selected.agentSlug, id: conversationId }
          : null;

  const key = target
    ? ["milestones", pid, target.kind, "agent" in target ? target.agent : target.channel, target.id, streaming ? "live" : "idle"]
    : null;

  const { data, error, isLoading, mutate } = useSWR<Timeline>(
    key,
    () =>
      target!.kind === "thread"
        ? Milestones.forThread(pid, (target as { channel: string }).channel, target!.id)
        : Milestones.forConversation(pid, (target as { agent: string }).agent, target!.id),
    {
      revalidateOnFocus: false,
      // A chat with no timeline is a normal answer, not a transient failure to
      // retry against.
      shouldRetryOnError: false,
    }
  );

  return {
    entries: data?.entries ?? [],
    stats: data?.stats ?? { total: 0, open: 0, done: 0, failed: 0 },
    loading: isLoading,
    error,
    reload: mutate,
  };
}
