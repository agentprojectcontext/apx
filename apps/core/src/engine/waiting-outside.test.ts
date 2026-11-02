// "Send now" for an agent whose engine only reads words between turns (DECISIONS.md#d-186): it stops the turn at
// work, as the composer's stop does, and the owner's message runs at once, ahead of anything else in line.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Message } from "@apx/protocol";
import type { Harness } from "../harness/index.ts";
import { type TempDir, tempDir, waitFor } from "../testkit/platform.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

/** An outside engine: a turn asking for "work" goes on until it is stopped; any other answers with what it read. */
let started = 0;
const claude: Harness = {
  id: "claude",
  run: (io) =>
    new Promise((resolve, reject) => {
      const text = String(io.input.content);
      started++;
      if (!text.includes("work")) return resolve({ text: `Heard: ${text}`, model: "claude/model" });
      io.signal.addEventListener("abort", () => reject(io.signal.reason), { once: true });
    }),
};

let env: Awaited<ReturnType<typeof startCore>>;
let repo: TempDir;
let project = "";
before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("unused")), harnesses: { claude } });
  repo = tempDir("apx-outside-");
  project = (await env.client.call("projects.register", { path: repo.path, init: true })).project.id;
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  await repo.remove();
});

const said = (m: Message) => m.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join(" ");

test("send now stops an outside engine's turn and runs the message at once, ahead of the rest of the line", async () => {
  const thread = (
    await env.client.call("threads.create", {
      kind: "code",
      agent_id: "superagent",
      project_id: project,
      engine: "claude",
    })
  ).id;
  const first = await env.client.call("threads.send", { thread, text: "work for long" });
  await waitFor(() => started === 1, "the turn at work");
  // Enter while it works: an outside engine cannot take it mid-turn, so it waits in line.
  const a = await env.client.call("threads.send", { thread, text: "alpha", mode: "steer" });
  const b = await env.client.call("threads.send", { thread, text: "bravo", mode: "steer" });
  assert.deepEqual(env.core.store.messages.get(b.message.id)?.waiting, { until: "turn", run: b.run.id });

  assert.deepEqual(await env.client.call("runs.send_now", { message: b.message.id }), { now: true });
  const { messages, runs } = await env.settle(thread);

  assert.equal(runs.find((r) => r.id === first.run.id)?.state, "canceled");
  assert.equal(runs.find((r) => r.id === b.run.id)?.state, "completed");
  assert.equal(runs.find((r) => r.id === a.run.id)?.state, "completed");
  const answers = messages.filter((m) => m.author.kind === "agent").map(said);
  assert.deepEqual(answers.slice(-2), ["Heard: bravo", "Heard: alpha"]);
  assert.ok(messages.every((m) => !m.waiting));
});
