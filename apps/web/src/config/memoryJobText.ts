import type { Result } from "@apx/protocol";
import type { T } from "../i18n/index.ts";

type Job = Result<"memory.status">["jobs"][number];

/** A shared AutoDream pass is queued as `dream:shared:<run>` (see the core's memory-job.ts). */
const isShared = (job: Job) => job.id.startsWith("dream:shared:");

const resultOf = (job: Job): Record<string, unknown> => {
  try {
    return job.result ? (JSON.parse(job.result) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const count = (v: unknown) => (typeof v === "number" && v > 0 ? v : 0);

/**
 * One row of the memory queue in the owner's words: whose notes it works on, and what it did or why it waits.
 * `agent` and `place` are names already resolved by the screen (`place` undefined: outside a project).
 */
export function memoryJobText(job: Job, t: T, agent: string, place: string | undefined) {
  const name =
    job.kind !== "dream"
      ? t("mem.job.capture", { agent })
      : isShared(job)
        ? place
          ? t("mem.job.sharedProject", { place })
          : t("mem.job.sharedGlobal")
        : t("mem.job.notebook", { agent });
  return { name, desc: describe(job, t, agent) };
}

function describe(job: Job, t: T, agent: string): string {
  if (job.state === "working") return t("mem.job.working");
  if (job.state === "failed") return t("mem.job.failed");
  if (job.state !== "completed") {
    if (job.error === "daily call budget exhausted") return t("mem.job.waitBudget");
    if (job.error === "waiting for idle agent") return t("mem.job.waitAgent", { agent });
    if (job.error === "no auxiliary model available") return t("mem.job.waitModel");
    return t("mem.job.pending");
  }
  const r = resultOf(job);
  if (job.kind !== "dream") {
    const saved = count(r.saved);
    return saved ? t("mem.job.saved", { n: saved }) : t("mem.job.nothingNew");
  }
  const parts = [
    count(r.merged) && t("mem.job.merged", { n: count(r.merged) }),
    count(r.retired) && t("mem.job.retired", { n: count(r.retired) }),
    count(r.redated) && t("mem.job.redated", { n: count(r.redated) }),
  ].filter(Boolean);
  if (parts.length) return parts.join(" · ");
  return typeof r.refused === "string" ? t("mem.job.tooMany") : t("mem.job.unchanged");
}
