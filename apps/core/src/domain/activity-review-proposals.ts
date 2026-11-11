import { createHash } from "node:crypto";
import { z } from "zod";
import { redactedJson } from "../log.ts";
import type { ReviewRuntime } from "./activity-review-state.ts";
import { memorySensitive } from "./memories.ts";
import type { Store } from "./store.ts";
import { noticeTaskProposed } from "./task-attention.ts";
import { columnsOf } from "./tasks.ts";

export type ReviewSource = {
  id: string;
  thread: string;
  project?: string;
  at: string;
  text: string;
  reply: string;
};
export const ReviewProposal = z
  .object({
    title: z.string().trim().min(8).max(140),
    project: z.string().nullable(),
    goal: z.string().trim().min(12).max(600),
    change: z.string().trim().min(20).max(1600),
    limitations: z.string().trim().min(12).max(600),
    acceptance: z.array(z.string().trim().min(8).max(300)).min(1).max(5),
    evidence: z
      .array(z.object({ message: z.string(), quote: z.string().trim().min(12).max(400) }).strict())
      .min(1)
      .max(4),
  })
  .strict();
type ReviewProposal = z.infer<typeof ReviewProposal>;
export const ReviewAnswer = z.object({ proposals: z.array(ReviewProposal).max(3) }).strict();
const fingerprint = (project: string | null | undefined, title: string) =>
  createHash("sha256")
    .update(JSON.stringify([project ?? null, title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")]))
    .digest("hex");

function valid(store: Store, proposal: ReviewProposal, sources: ReviewSource[]): boolean {
  const text = JSON.stringify(proposal);
  return (
    !memorySensitive(text) &&
    redactedJson(proposal) === text &&
    proposal.evidence.every((e) => {
      const source = sources.find((s) => s.id === e.message);
      return !!source && (source.project ?? null) === proposal.project && source.text.includes(e.quote);
    }) &&
    (!proposal.project || !!store.projects.get(proposal.project))
  );
}
function descriptionOf(store: Store, p: ReviewProposal, sources: ReviewSource[]) {
  const en = store.settings.get("owner_language") === "en";
  const labels = en
    ? ["Proposed change", "Evidence", "Acceptance criteria", "Limitations", "Proposal only. Nothing has been applied."]
    : [
        "Cambio propuesto",
        "Evidencia",
        "Criterios de aceptación",
        "Limitaciones",
        "Solo propuesta. No se aplicó ningún cambio.",
      ];
  return [
    labels[4],
    `## ${labels[0]}\n${p.change}`,
    `## ${labels[1]}\n${p.evidence
      .map((e) => {
        const s = sources.find((s) => s.id === e.message);
        return `- [${en ? "Conversation" : "Conversación"}](apx:chat/${s?.thread}) · ${s?.at}\n  > ${e.quote.replace(/\n/g, "\n  > ")}`;
      })
      .join("\n")}`,
    `## ${labels[2]}\n${p.acceptance.map((c) => `- ${c}`).join("\n")}`,
    `## ${labels[3]}\n${p.limitations}`,
  ].join("\n\n");
}

/** Proposals and the consumed window commit together; interrupted calls are never replayed. */
export function commitReviewProposals(deps: {
  store: Store;
  proposals: ReviewProposal[];
  sources: ReviewSource[];
  snapshot: ReviewRuntime;
  boss: string;
  finish: (state: ReviewRuntime) => void;
}): void {
  const { store, proposals, sources, snapshot, boss } = deps;
  store.tx(() => {
    const seen = new Set(snapshot.seen);
    const used = new Set<string>();
    for (const p of proposals) {
      const key = fingerprint(p.project, p.title);
      if (
        seen.has(key) ||
        store.tasks.hasOpenTitle(p.title, p.project) ||
        p.evidence.some((e) => used.has(e.message)) ||
        !valid(store, p, sources)
      )
        continue;
      const thread = store.threads.create({
        kind: "task",
        title: p.title,
        agent_ids: [boss],
        project_id: p.project ?? undefined,
      });
      const task = store.tasks.create({
        title: p.title,
        goal: p.goal,
        description: descriptionOf(store, p, sources),
        project_id: p.project ?? undefined,
        thread_id: thread.id,
        proposed: true,
        status: columnsOf(store)[0]?.id ?? "backlog",
        tags: ["Activity review"],
        by: boss,
      });
      noticeTaskProposed(store, task);
      seen.add(key);
      for (const e of p.evidence) used.add(e.message);
    }
    deps.finish({ ...snapshot, seen: [...seen].slice(-200), state: "completed" });
  });
}
