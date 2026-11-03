import type { TaskEvent } from "@apx/protocol";

/** Stable codes only: never store the decision's free-text rationale or request content. */
export type ProposalReason =
  | "explicit"
  | "task_ancestry_depth"
  | "task_ancestry_backflow"
  | "active_chain_backflow"
  | "handoff_limit"
  | "authority_lost"
  | "other";
export function proposalReasonCode(forced: string | undefined): ProposalReason {
  if (!forced) return "explicit";
  if (forced.startsWith("it would ") && forced.endsWith("hand-offs deep")) return "task_ancestry_depth";
  if (forced === "it gives work back up its active chain") return "active_chain_backflow";
  if (forced === "it gives work back up its own chain") return "task_ancestry_backflow";
  if (forced.includes("handoff limit")) return "handoff_limit";
  if (forced.includes("authorization no longer covers")) return "authority_lost";
  return "other";
}
export function proposalProvenance(proposed: boolean | undefined, events: TaskEvent[]) {
  if (!proposed) return undefined;
  const at = events.findLastIndex((e) => e.data.proposed === true || e.data.proposed === false);
  if (at < 0 || events[at]?.data.proposed !== true) return { reason: "unknown" as const };
  const record = events[at];
  // A pending proposal can be edited in place. Never describe old provenance as applying to a changed payload.
  if (events.slice(at + 1).some((e) => e.op !== "comment")) return { reason: "unknown" as const };
  const p = record?.data.proposal_provenance;
  if (!record || !p || typeof p !== "object") return { reason: "unknown" as const };
  const v = p as Record<string, unknown>;
  const allowed: readonly string[] = [
    "explicit",
    "task_ancestry_depth",
    "task_ancestry_backflow",
    "active_chain_backflow",
    "handoff_limit",
    "authority_lost",
    "other",
  ];
  if (
    v.version !== 1 ||
    typeof v.reason !== "string" ||
    !allowed.includes(v.reason) ||
    typeof v.explicit !== "boolean" ||
    (v.actor_scope !== "agent_run" && v.actor_scope !== "unattributed") ||
    (v.actor_scope === "unattributed" && record.by !== "owner") ||
    (v.actor_scope === "agent_run" && record.by === "owner")
  )
    return { reason: "unknown" as const };
  return {
    reason: v.reason as ProposalReason,
    explicit: v.explicit,
    actor: v.actor_scope === "agent_run" ? record.by : "unattributed",
    actor_scope: v.actor_scope,
  };
}
