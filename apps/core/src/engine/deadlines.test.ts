import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { Harness } from "../harness/types.ts";
import { RUN_DEADLINE_MS } from "./engine.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

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

let env: Awaited<ReturnType<typeof startCore>>;
let project = "";
before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("ok")), harnesses: { claude }, engineIdleMs: IDLE_MS });
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

test("a chat turn keeps its fixed minutes", async () => {
  const chat = (await env.client.call("threads.create", { kind: "loose", agent_id: "roby" })).id;
  await env.client.call("threads.send", { thread: chat, text: "hola" });
  const run = env.core.store.runs.list(chat, 1)[0];
  const ms = Date.parse(run?.deadline_at ?? "") - Date.parse(run?.started_at ?? "");
  assert.ok(Math.abs(ms - RUN_DEADLINE_MS) < 5000, `chat turn: ${ms}`);
});
