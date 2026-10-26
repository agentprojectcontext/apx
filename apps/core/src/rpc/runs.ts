import { publicInput } from "../domain/inputs.ts";
import { RUN_CONTEXTS_KEPT } from "../domain/run-contexts.ts";
import { publicRun } from "../domain/runs.ts";
import { HOME_THREAD_ID } from "../domain/seed.ts";
import type { Store } from "../domain/store.ts";
import type { Engine } from "../engine/engine.ts";
import { notFound } from "../errors.ts";
import type { Handlers } from "./router.ts";

/** Runs of a thread (pending inputs, answers, waits) and widget prompts, which start one. */
export function runHandlers(store: Store, engine: Engine) {
  return {
    "runs.pending": ({ thread }) => ({ inputs: engine.pending(thread) }),
    // A channel's answer carries the channel the owner wrote on (set by the channel manager, never by a request).
    "runs.respond": ({ input, decision, text, scope }, ctx) =>
      publicInput(engine.respond(input, { decision, text, scope }, Boolean(ctx.channel))),
    "runs.list": ({ agent, limit, before }) => {
      const runs = store.runs.byAgent(agent, limit, before);
      const threads = [...new Set(runs.map((r) => r.thread_id))].flatMap((id) => {
        const th = store.threads.get(id);
        return th ? [{ id, title: th.title, kind: th.kind }] : [];
      });
      return { runs: runs.map(publicRun), threads };
    },
    "runs.get": ({ run }) => {
      const r = store.runs.get(run);
      if (!r) throw notFound(`run ${run}`);
      return publicRun(r);
    },
    "runs.context": ({ run }) => {
      if (!store.runs.get(run)) throw notFound(`run ${run}`);
      const c = store.runContexts.get(run);
      if (!c) throw notFound(`the context of run ${run} (only the latest ${RUN_CONTEXTS_KEPT} runs keep it)`);
      return c;
    },
    "runs.wait": async ({ run, timeout_s }) => {
      const r = await engine.wait(run, timeout_s * 1000);
      if (!r) throw notFound(`run ${run}`);
      return publicRun(r);
    },
    /** A widget's sendPrompt(): an input on the thread that owns the widget, marked as coming from it. */
    "surfaces.prompt": ({ surface, text }) => {
      const s = store.surfaces.get(surface);
      if (!s) throw notFound(`surface ${surface}`);
      const threadId = s.thread_id ?? HOME_THREAD_ID;
      const agent = store.agents.get(store.threads.get(threadId)?.agent_ids[0] ?? "");
      if (!agent) throw notFound(`agent of thread ${threadId}`);
      return store.tx(() => {
        store.messages.add({
          thread_id: threadId,
          author: { kind: "surface", id: s.id, title: s.title },
          parts: [{ type: "text", text }],
        });
        const run = engine.admit({
          thread_id: threadId,
          agent_id: agent.id,
          trigger: "surface",
          origin: { kind: "surface", id: s.id, title: s.title },
          text,
        });
        return { thread: threadId, run: publicRun(run) };
      });
    },
  } satisfies Partial<Handlers>;
}
