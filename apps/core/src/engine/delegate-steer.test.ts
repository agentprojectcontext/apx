// A caller's newer words to a session still at work reach its running turn at the next step, not a turn queued
// behind it: a "pause everything" must not wait for the release it is meant to stop (DECISIONS.md#d-222).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { callTool, say, scriptedLlm, startCore, texts } from "./testkit.ts";

const PAUSE = "PAUSE all previous work, do not publish";
const relayed: string[] = [];
let steps = 0;

const llm = scriptedLlm((req, { system, said, afterTool }) => {
  if (system.startsWith("You are Vera")) {
    const paused = req.messages.some((m) => m.role === "user" && String(m.content).includes(PAUSE));
    if (paused) return say("Paused as asked; nothing published.");
    // The long release: one step after another until something stops it.
    steps++;
    return callTool(`s${steps}`, "shell", { command: "sleep 0.05" });
  }
  if (said.includes("<delegation_result")) return say("Noted.");
  if (afterTool) {
    relayed.push(String(req.messages.findLast((m) => m.role === "tool")?.content ?? ""));
    return say("Relayed.");
  }
  if (said.includes("start the release"))
    return callTool("d1", "delegate", { agent: "vera", session: "release", task: "publish the release", wait_s: 0 });
  if (said.includes("stop the release"))
    return callTool("d2", "delegate", { session: "release", task: PAUSE, wait_s: 0 });
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

test("a pause sent to a session at work joins its running turn instead of waiting behind it", async () => {
  const chat = (await env.client.call("threads.create", { kind: "loose", agent_id: "superagent", title: "release" }))
    .id;
  await env.client.call("threads.send", { thread: chat, text: "start the release" });
  await waitFor(() => env.core.store.threads.sessions(chat).length === 1, "the session opened");
  const session = env.core.store.threads.sessions(chat)[0]?.id ?? "";
  await waitFor(() => steps >= 2, "the session's turn is at work");
  const [working] = env.core.store.runs.list(session);
  assert.equal(working?.state, "working");

  await env.client.call("threads.send", { thread: chat, text: "stop the release" });
  await waitFor(() => relayed.length === 2, "the super-agent relayed the pause");
  assert.match(relayed[1] ?? "", /^sent: .*still working in session "release"/);

  await waitFor(() => env.core.store.runs.get(working?.id ?? "")?.state === "completed", "the running turn ended");
  // One turn took both: no second run was queued behind the one at work.
  const runs = env.core.store.runs.list(session);
  assert.deepEqual(
    runs.map((r) => r.id),
    [working?.id],
  );
  const said = texts(env.core.store.messages.list(session));
  assert.ok(said.includes(PAUSE), "the pause shows in the session's chat");
  assert.ok(said.includes("Paused as asked; nothing published."));
});
