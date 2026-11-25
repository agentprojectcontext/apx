// The owner's agents reach the owner's other chats and say where they acted; outsiders' turns keep their own chat
// (DECISIONS.md#d-271).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Thread } from "@apx/protocol";
import { callTool, say, scriptedLlm, startCore, texts } from "../engine/testkit.ts";

const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(`seen: ${String(req.messages.at(-1)?.content)}`);
  const [verb, arg = ""] = said.split(":");
  if (verb === "out") return callTool("o1", "shell_output", { job: arg });
  if (verb === "kill") return callTool("k1", "shell_kill", { job: arg });
  if (verb === "more") return callTool("m1", "read_output", { ref: arg });
  if (verb === "stop") return callTool("s1", "stop_session", { session: arg });
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
let builder = "";
let northwind = "";
before(async () => {
  env = await startCore({ llm });
  const { project: acme } = await env.client.call("projects.create", { name: "Acme" });
  northwind = (await env.client.call("projects.create", { name: "Northwind" })).project.id;
  builder = (await env.client.call("agents.create", { project_id: acme.id, slug: "builder", name: "Builder" })).id;
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

/** A chat of the builder's (in Acme), and the chat in Northwind it takes no part in. */
function chats(title: string) {
  const store = env.core.store;
  const own = store.threads.create({
    kind: "loose",
    title,
    agent_ids: [builder],
    project_id: store.agents.get(builder)?.project_id,
  });
  const other = store.threads.create({
    kind: "loose",
    title: "Northwind build",
    agent_ids: ["superagent"],
    project_id: northwind,
  });
  return { own, other };
}

/** The same Acme chat, working for an outside app. */
function outsideChat(): Thread {
  const t = env.core.store.threads.create({ kind: "loose", title: "Outside app", agent_ids: [builder] });
  env.core.store.threads.mergeContext(t.id, { client: "external" });
  return t;
}

const answer = async (thread: string, text: string) => {
  await env.client.call("threads.send", { thread, text });
  return texts((await env.settle(thread)).messages).at(-1) ?? "";
};

test("shell_output and shell_kill reach a job in another of the owner's chats and name it", async () => {
  const { own, other } = chats("Acme jobs");
  const job = env.core.store.jobs.create({ thread_id: other.id, title: "build", cwd: ".", background: true });
  assert.match(await answer(own.id, `out:${job.id}`), /job from chat Northwind build \(project Northwind\)/);
  assert.match(
    await answer(own.id, `kill:${job.id}`),
    /job \S+ (stopped|was not running) in chat Northwind build \(project Northwind\)/,
  );
  const outside = outsideChat().id;
  assert.match(await answer(outside, `out:${job.id}`), /only read its own thread's jobs/);
  assert.match(await answer(outside, `kill:${job.id}`), /only stop its own thread's jobs/);
});

test("read_output pages an output of another of the owner's chats, saying where it was made", async () => {
  const { own, other } = chats("Acme outputs");
  const store = env.core.store;
  const run = store.runs.create({
    thread_id: other.id,
    agent_id: "superagent",
    trigger: "user",
    input: { text: "Check", origin: { kind: "user" } },
    deadline_at: new Date(Date.now() + 60_000).toISOString(),
  });
  const ref = store.runs.beginStep(run.id, { call_id: "c1", tool: "shell", args: {}, effect: "none" });
  store.runs.endStep(run.id, "c1", "ok", "cut", "the whole northwind log");
  store.runs.setState(run, "completed");
  const read = await answer(own.id, `more:${ref}`);
  assert.match(read, /output from chat Northwind build \(project Northwind\)/);
  assert.match(read, /the whole northwind log/);
  assert.match(await answer(outsideChat().id, `more:${ref}`), /no output \S+ in a chat you can read/);
});

test("stop_session stops a session of another of the owner's chats and names that chat", async () => {
  const { own, other } = chats("Acme sessions");
  const store = env.core.store;
  const session = store.threads.create({
    kind: "a2a",
    title: "Northwind review",
    agent_ids: ["superagent"],
    project_id: northwind,
    parent_id: other.id,
    session: "review",
  });
  // stop_session is offered while one of this chat's own sessions is at work.
  const mine = store.threads.create({
    kind: "a2a",
    title: "Own session",
    agent_ids: ["superagent"],
    project_id: own.project_id,
    parent_id: own.id,
    session: "mine",
  });
  store.threads.patch(mine.id, { state: "working" });
  assert.match(
    await answer(own.id, `stop:${session.id}`),
    /session "review" (stopped|was not working) in chat Northwind build \(project Northwind\)/,
  );
  const outside = outsideChat();
  const theirs = store.threads.create({
    kind: "a2a",
    title: "Outside session",
    agent_ids: ["superagent"],
    parent_id: outside.id,
    session: "theirs",
  });
  store.threads.patch(theirs.id, { state: "working" });
  assert.match(await answer(outside.id, `stop:${session.id}`), /no session "\S+" in this thread/);
});
