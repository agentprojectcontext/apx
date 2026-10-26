// What the model received on a run's first call, kept for the owner to look at (runs.context). Only the latest runs
// are kept; a chat's system prompt is the same on every turn, so each one is stored once by its hash.
import { createHash } from "node:crypto";
import type { RunContext } from "@apx/protocol";
import { qb, type Sql } from "./sql.ts";

/** Runs whose context is kept; older ones are dropped as new ones come. */
export const RUN_CONTEXTS_KEPT = 50;

export function runContextsRepo({ one, run }: Sql) {
  return {
    add(c: RunContext): void {
      const hash = createHash("sha256").update(c.system).digest("hex");
      run(
        qb
          .insertInto("prompt_texts")
          .values({ hash, text: c.system })
          .onConflict((oc) => oc.doNothing()),
      );
      const last = one(qb.selectFrom("run_contexts").select((eb) => eb.fn.max("seq").as("seq")));
      const seq = Number(last?.seq ?? 0) + 1;
      run(
        qb
          .insertInto("run_contexts")
          .values({
            run_id: c.run_id,
            seq,
            system_hash: hash,
            input: c.input,
            tools: JSON.stringify(c.tools),
            sizes: JSON.stringify(c.sizes),
          })
          .onConflict((oc) => oc.doNothing()),
      );
      run(qb.deleteFrom("run_contexts").where("seq", "<=", seq - RUN_CONTEXTS_KEPT));
      run(
        qb
          .deleteFrom("prompt_texts")
          .where("hash", "not in", qb.selectFrom("run_contexts").select("system_hash").distinct()),
      );
    },
    get(runId: string): RunContext | undefined {
      const r = one(
        qb
          .selectFrom("run_contexts")
          .innerJoin("prompt_texts", "prompt_texts.hash", "run_contexts.system_hash")
          .select(["run_contexts.input", "run_contexts.tools", "run_contexts.sizes", "prompt_texts.text"])
          .where("run_contexts.run_id", "=", runId),
      );
      return r
        ? { run_id: runId, system: r.text, input: r.input, tools: JSON.parse(r.tools), sizes: JSON.parse(r.sizes) }
        : undefined;
    },
  };
}
