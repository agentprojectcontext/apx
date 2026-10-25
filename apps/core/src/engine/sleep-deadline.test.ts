import assert from "node:assert/strict";
import { test } from "node:test";
import { manualTimers, waitFor } from "../testkit/platform.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

const IDLE_MS = 300;

/** A model that answers after one and a half idle windows of the test's own clock. */
function slowModel(timers: ReturnType<typeof manualTimers>) {
  let waiting = 0;
  const llm = scriptedLlm(
    (req) =>
      new Promise((resolve, reject) => {
        waiting++;
        const cancel = timers.after(IDLE_MS * 1.5, () => resolve(say("Listo, después de dormir")));
        req.signal?.addEventListener("abort", () => {
          cancel();
          reject(req.signal?.reason);
        });
      }),
  );
  return { llm, waiting: () => waiting };
}

for (const slept of [true, false])
  test(`a turn whose deadline comes ${slept ? "across a sleep gets one more window" : "while awake is stopped as stuck"}`, async () => {
    const timers = manualTimers();
    const model = slowModel(timers);
    const env = await startCore({ llm: model.llm, turnIdleMs: IDLE_MS, runTimers: timers, sleptSince: () => slept });
    try {
      await env.client.call("threads.send", { thread: "home", text: "Hola" });
      await waitFor(() => model.waiting() > 0, "the model call");
      timers.tick(IDLE_MS);
      timers.tick(IDLE_MS / 2);
      const run = await waitFor(() => {
        const r = env.core.store.runs.list("home", 1)[0];
        return r?.ended_at ? r : undefined;
      }, "the run's end");
      assert.equal(run.state, slept ? "completed" : "failed");
      if (!slept) assert.match(run.error ?? "", /made no progress/);
    } finally {
      await env.core.close();
      await env.cleanup();
    }
  });
