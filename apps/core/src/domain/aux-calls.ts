// The auxiliary model's calls (a chat's title, a long chat's summary, a room's "worth answering?", a commit message):
// no run holds them, so each one's tokens are kept here, one row per call, for the last 90 days.
import type { AuxPurpose } from "@apx/protocol";
import type { Usage } from "../providers/types.ts";
import { now, qb, type Sql } from "./sql.ts";

const KEEP_DAYS = 90;

/** What an auxiliary call was for, and the chat or project it was about. */
export type AuxAbout = { purpose: AuxPurpose; thread_id?: string | undefined; project_id?: string | undefined };

export type AuxTotals = { purpose: AuxPurpose; model: string; calls: number; input: number; output: number };

export function auxCallsRepo({ all, run }: Sql) {
  const totals = (q: {
    since?: string | undefined;
    project?: string | undefined;
    thread?: string | undefined;
  }): AuxTotals[] =>
    all(
      qb
        .selectFrom("aux_calls")
        .select((eb) => [
          "purpose",
          "model",
          eb.fn.countAll<number>().as("n"),
          eb.fn.sum<number>("input").as("i"),
          eb.fn.sum<number>("output").as("o"),
        ])
        .$if(!!q.since, (s) => s.where("at", ">=", q.since as string))
        .$if(!!q.project, (s) => s.where("project_id", "=", q.project as string))
        .$if(!!q.thread, (s) => s.where("thread_id", "=", q.thread as string))
        .groupBy(["purpose", "model"])
        .orderBy("n", "desc"),
    ).map((r) => ({
      purpose: r.purpose as AuxPurpose,
      model: r.model,
      calls: Number(r.n),
      input: Number(r.i ?? 0),
      output: Number(r.o ?? 0),
    }));
  return {
    add(about: AuxAbout, model: string, usage: Usage): void {
      run(
        qb.insertInto("aux_calls").values({
          at: now(),
          purpose: about.purpose,
          model,
          thread_id: about.thread_id ?? null,
          project_id: about.project_id ?? null,
          input: usage.input,
          output: usage.output,
          cached: usage.cached ?? 0,
        }),
      );
      run(qb.deleteFrom("aux_calls").where("at", "<", new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString()));
    },
    /** Tokens by purpose and model since `since`, optionally in one project. */
    since: (since: string, project?: string) => totals({ since, project }),
    /** Tokens by purpose and model about one chat, all it kept. */
    ofThread: (thread: string) => totals({ thread }),
  };
}
