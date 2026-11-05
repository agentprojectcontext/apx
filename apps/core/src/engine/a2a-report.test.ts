// A delegated task is asked for one report in a fixed shape, and the caller gets that report, with no acknowledgement
// turn between them.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

const SHAPE = /Status: done or blocked; Result:; Evidence: .*; Unblock: /;
const REPORT = "Status: done\nResult: the build passes\nEvidence: pnpm build exited 0\nUnblock: none";

let builder = "";
const llm = scriptedLlm((_req, { system, said, afterTool }) => {
  if (system.startsWith("You are Builder")) return say(SHAPE.test(said) ? REPORT : "Got it, on it.");
  if (said.includes("ask the builder") && !afterTool)
    return callTool("b1", "delegate", { agent: builder, task: "Check the build." });
  return say("The build passes.");
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
  builder = (await env.client.call("agents.create", { slug: "builder", name: "Builder" })).id;
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

test("a delegated task asks for the four-line report, and the caller gets it in one answer", async () => {
  const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" });
  await env.client.call("threads.send", { thread: chat.id, text: "ask the builder" });
  await env.settle(chat.id);
  const [sub] = env.core.store.threads.sessions(chat.id);
  assert.ok(sub, "a sub-thread with the builder");
  await env.settle(sub.id);

  const asked = llm.calls.filter((c) => String(c.messages[0]?.content).startsWith("You are Builder"));
  assert.equal(asked.length, 1, "one model call: the report, no acknowledgement before it");
  const input = String(asked[0]?.messages.at(-1)?.content);
  assert.match(input, /No acknowledgement: do the work, then answer once/);
  assert.match(input, SHAPE);
  assert.equal(env.core.store.runs.list(sub.id, 20).length, 1, "one run in the sub-thread");

  const back = llm.calls.at(-1)?.messages.find((m) => m.role === "tool");
  assert.match(String(back?.content), /Status: done\nResult: the build passes\nEvidence: .*\nUnblock: none/);
});
