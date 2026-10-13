import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { z } from "zod";
import type { Harness } from "../harness/types.ts";
import { defineTool } from "../tools/types.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

const IDLE_MS = 300;
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    const stop = () => {
      clearTimeout(t);
      reject(signal.reason);
    };
    signal.addEventListener("abort", stop, { once: true });
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
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx-deadline-")));
  project = (await env.client.call("projects.register", { path: repo, init: true })).project.id;
});
after(async () => {
  await env.core.close();
  env.cleanup();
});

const ended = async (thread: string, text: string) => {
  await env.client.call("threads.send", { thread, text });
  const id = env.core.store.runs.list(thread, 1)[0]?.id ?? "";
  for (let i = 0; i < 100; i++) {
    const run = env.core.store.runs.get(id);
    if (run?.ended_at) return run;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail("the run never ended");
};

const codeThread = async () =>
  (
    await env.client.call("threads.create", {
      kind: "code",
      agent_id: "roby",
      project_id: project,
      engine: "claude",
    })
  ).id;

test("an outside engine that keeps sending events works past its idle window", async () => {
  const run = await ended(await codeThread(), "keep going");
  assert.equal(run.state, "completed", run.error);
});

test("an outside engine that goes quiet is stopped, and the owner reads why", async () => {
  const run = await ended(await codeThread(), "think quietly");
  assert.equal(run.state, "failed");
  assert.match(run.error ?? "", /sent nothing/);
});

const chat = async () => (await env.client.call("threads.create", { kind: "loose", agent_id: "roby" })).id;

test("a turn on our own loop that keeps making progress works past its idle window", async () => {
  const run = await ended(await chat(), "keep going");
  assert.equal(run.state, "completed", run.error);
  assert.equal(run.tool_calls, 9);
});

test("a turn on our own loop that makes no progress is stopped, and the owner reads why", async () => {
  const run = await ended(await chat(), "think quietly");
  assert.equal(run.state, "failed");
  assert.match(run.error ?? "", /no progress/);
});
