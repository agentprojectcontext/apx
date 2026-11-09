import type { ActivityReviewSettings, ActivityReviewStatus } from "@apx/protocol";
import { commitReviewProposals, ReviewAnswer } from "../domain/activity-review-proposals.ts";
import { activityReviewState, REVIEW_DAY, type ReviewRuntime, reviewPeriod } from "../domain/activity-review-state.ts";
import type { Store } from "../domain/store.ts";
import { redactedJson } from "../log.ts";
import type { Llm } from "../providers/llm.ts";
import { REVIEW_PROMPT } from "./activity-review-prompt.ts";
import { activityReviewBatches, activityReviewSources, reviewReference } from "./activity-review-source.ts";
import type { BackgroundCheck } from "./background.ts";

export function createActivityReview(deps: { store: Store; llm: Llm; models: () => string[]; now?: () => Date }) {
  const { store } = deps;
  const state = activityReviewState(store, deps.now ?? (() => new Date()));
  const recovered = state.read();
  if (recovered.state === "working") state.write({ ...recovered, state: "uncertain" });
  let generation = 0;
  let stopped = false;
  let controller: AbortController | undefined;
  let running: Promise<void> | undefined;

  function status(): ActivityReviewStatus {
    const r = state.read();
    const settings = store.settings.read("activity_review");
    return {
      settings,
      available: deps.models().length > 0,
      state: r.state,
      ...(settings.enabled ? { next_at: r.next } : {}),
      ...(r.last ? { last_at: r.last } : {}),
    };
  }
  function configure(patch: Partial<ActivityReviewSettings>, expected?: ActivityReviewSettings): ActivityReviewStatus {
    state.configure(patch, expected);
    generation++;
    controller?.abort();
    return status();
  }

  async function review(at: Date): Promise<void> {
    const settings = store.settings.read("activity_review");
    const current = state.read();
    if (stopped || !settings.enabled || +at < Date.parse(current.next)) return;
    const models = deps.models().slice(0, 1);
    const boss = store.agents.list().find((a) => a.kind === "secretary");
    if (!models.length || !boss) return;
    const stamp = generation;
    const until = at.toISOString();
    const from = new Date(Math.max(Date.parse(current.cursor), +at - 7 * REVIEW_DAY)).toISOString();
    const sources = activityReviewSources(store, from, until);
    const snapshot: ReviewRuntime = {
      ...current,
      cursor: until,
      next: new Date(+at + reviewPeriod(settings)).toISOString(),
      last: until,
      state: sources.length ? "working" : "completed",
    };
    state.write(snapshot);
    if (!sources.length) return;
    const ac = new AbortController();
    controller = ac;
    try {
      const batches = activityReviewBatches(sources);
      const proposals: ReturnType<typeof ReviewAnswer.parse>["proposals"] = [];
      const signal = AbortSignal.any([ac.signal, AbortSignal.timeout(60_000)]);
      for (const batch of batches) {
        signal.throwIfAborted();
        const answer = await deps.llm.complete({
          models,
          tools: [],
          once: true,
          maxOutputTokens: Math.floor(2400 / batches.length),
          signal,
          messages: [
            { role: "system", content: REVIEW_PROMPT },
            {
              role: "user",
              content: redactedJson({
                ...reviewReference(store, batch),
                extra_details: settings.extra_details,
              }),
            },
          ],
        });
        if (answer.usage) store.auxCalls.add({ purpose: "activity_review" }, answer.model, answer.usage);
        if (stopped || stamp !== generation || ac.signal.aborted) return;
        signal.throwIfAborted();
        if (!deps.models().includes(models[0] ?? "")) {
          state.write({ ...snapshot, state: "cancelled" });
          return;
        }
        const parsed = ReviewAnswer.parse(JSON.parse(String(answer.message.content)));
        proposals.push(
          ...parsed.proposals
            .filter(
              (p) =>
                p.project === (batch[0]?.project ?? null) &&
                p.evidence.every((e) => batch.some((s) => s.id === e.message)),
            )
            .slice(0, 1),
        );
      }
      const live = activityReviewSources(store, from, until).filter((s) =>
        sources.some((old) => old.id === s.id && old.text === s.text && old.project === s.project),
      );
      commitReviewProposals({
        store,
        proposals,
        sources: live,
        snapshot,
        boss: boss.id,
        finish: state.write,
      });
    } catch {
      if (stamp === generation && !stopped)
        state.write({ ...snapshot, state: ac.signal.aborted ? "cancelled" : "failed" });
    } finally {
      controller = undefined;
    }
  }
  const check: BackgroundCheck = {
    id: "activity-review",
    everyMs: 60_000,
    run(at) {
      if (running) return running;
      running = review(at).finally(() => {
        running = undefined;
      });
      return running;
    },
  };
  return {
    status,
    configure,
    check,
    async close() {
      stopped = true;
      generation++;
      controller?.abort();
      const r = state.read();
      if (r.state === "working") state.write({ ...r, state: "cancelled" });
      await running;
    },
  };
}
export type ActivityReview = ReturnType<typeof createActivityReview>;
