import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, type TestContext, test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { z } from "zod";
import type { Harness } from "../harness/types.ts";
import { realpath } from "../paths.ts";
import { defineTool } from "../tools/types.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

const IDLE_MS = 300;
let queuedSteps = 0;
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve();
    }, ms);
    const stop = () => {
      clearTimeout(t);
      reject(signal.reason);
    };
    signal.addEventListener("abort", stop, { once: true });
    queuedSteps++;
    if (signal.aborted) stop();
  });

// "keep going": works three idle windows long, with an event every 100 ms. Anything else: goes quiet.
const claude: Harness = {
  id: "claude",
  async run(io) {
    const busy = io.input.content.includes("keep going");
    for (let i = 0; i < (busy ? 9 : 1); i++) {
      io.alive?.();
      io.onText(`step ${i}`);
      await sleep(busy ? 100 : IDLE_MS * 3, io.signal);
    }
    return { text: "done", model: "claude/default" };
  },
};

/** One step of a long job on our own loop: a third of the idle window. */
const slowStep = defineTool({
  name: "slow_step",
  description: "test tool",
  args: z.object({ n: z.number() }),
  effect: "none",
  deadlineMs: 5_000,
  title: () => "Slow step",
  run: async (_args, ctx) => {
    await sleep(IDLE_MS / 3, ctx.signal);
    return "done";
  },
});

// "keep going": nine slow steps, three idle windows in all. "think quietly": the model says nothing for too long.
const llm = scriptedLlm(async (req, { said }) => {
  if (said.includes("think quietly")) {
    await sleep(IDLE_MS * 3, req.signal);
    return say("late");
  }
  const steps = req.messages.filter((m) => m.role === "tool").length;
  return said.includes("keep going") && steps < 9 ? callTool(`c${steps}`, "slow_step", { n: steps }) : say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
let project = "";
before(async () => {
  env = await startCore({
    llm,
    harnesses: { claude },
    extraTools: [slowStep],
    engineIdleMs: IDLE_MS,
    turnIdleMs: IDLE_MS,
  });
  const repo = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-deadline-")));
  project = (await env.client.call("projects.register", { path: repo, init: true })).project.id;
});
after(async () => {
  await env.core.close();
  env.cleanup();
});

async function until(check: () => boolean) {
  const start = performance.now();
  while (!check()) {
    assert.ok(performance.now() - start < 5000, "the run did not reach its next step");
    await setImmediate();
  }
}

async function ended(t: TestContext, thread: string, text: string) {
  queuedSteps = 0;
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
  const start = Date.now();
  let id = "";
  try {
    await env.client.call("threads.send", { thread, text });
    id = env.core.store.runs.list(thread, 1)[0]?.id ?? "";
    assert.ok(id);
    const current = () => env.core.store.runs.get(id);
    const busy = text.includes("keep going");
    // Keep real I/O out of simulated idle time; advance only after the fixture installs its next timer.
    for (let step = 1; step <= (busy ? 9 : 1); step++) {
      await until(() => queuedSteps >= step || !!current()?.ended_at);
      assert.ok(queuedSteps >= step, current()?.error);
      t.mock.timers.tick(busy ? IDLE_MS / 3 : IDLE_MS);
    }
    await until(() => !!current()?.ended_at);
    const run = current();
    assert.ok(run);
    return { run, elapsed: Date.now() - start };
  } finally {
    try {
      if (id && !env.core.store.runs.get(id)?.ended_at) {
        await env.client.call("threads.cancel", { thread });
        await until(() => !!env.core.store.runs.get(id)?.ended_at);
      }
      // Let background indexing finish its zero-delay yield before restoring real timers.
      await setImmediate();
      t.mock.timers.tick(0);
      await setImmediate();
    } finally {
      t.mock.timers.reset();
    }
  }
}

const codeThread = async () =>
  (
    await env.client.call("threads.create", {
      kind: "code",
      agent_id: "roby",
      project_id: project,
      engine: "claude",
    })
  ).id;

test("an outside engine that keeps sending events works past its idle window", async (t) => {
  const { run, elapsed } = await ended(t, await codeThread(), "keep going");
  assert.equal(run.state, "completed", run.error);
  assert.equal(elapsed, IDLE_MS * 3);
});

test("an outside engine that goes quiet is stopped, and the owner reads why", async (t) => {
  const { run, elapsed } = await ended(t, await codeThread(), "think quietly");
  assert.equal(run.state, "failed");
  assert.match(run.error ?? "", /sent nothing/);
  assert.equal(elapsed, IDLE_MS);
});

const chat = async () => (await env.client.call("threads.create", { kind: "loose", agent_id: "roby" })).id;

test("a turn on our own loop that keeps making progress works past its idle window", async (t) => {
  const { run, elapsed } = await ended(t, await chat(), "keep going");
  assert.equal(run.state, "completed", run.error);
  assert.equal(run.tool_calls, 9);
  assert.equal(elapsed, IDLE_MS * 3);
});

test("a turn on our own loop that makes no progress is stopped, and the owner reads why", async (t) => {
  const { run, elapsed } = await ended(t, await chat(), "think quietly");
  assert.equal(run.state, "failed");
  assert.match(run.error ?? "", /no progress/);
  assert.equal(elapsed, IDLE_MS);
});
