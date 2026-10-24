import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { Message } from "@apx/protocol";
import { ownerQuestionProblem } from "../domain/owner-question.ts";
import { realpath } from "../paths.ts";
import { removeDir } from "../testkit/platform.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

const STAND_INS = [
  "placeholder",
  "x",
  "?",
  "??",
  "tbd",
  "TODO",
  "n/a",
  "test",
  "Need update",
  "ok",
  "xxxxx",
  "<your question here>",
  "DISREGARD: no decision requested",
  "Disregard",
  "Ignore my previous question",
  "Never mind, I found it.",
  "Sent by mistake",
  "No action needed.",
  "Ignorá esto",
  "Olvidalo",
  "Perdón, fue un error",
  "Enviado por error, no hace falta responder",
  "Pregunta de prueba",
];

const REAL = [
  "Which color should the launch banner use?",
  "Deploy?",
  "¿Sigo?",
  "Should I ignore this warning and deploy anyway?",
  "Disregard the old budget and go with plan B?",
  "¿Descartamos el borrador de ayer?",
  "No importa el costo: ¿pago el envío urgente?",
  "Do you want the test suite to run nightly?",
];

const STAND_IN = "stand-in:";
const WITHDRAW = "withdraw:";
const COMMENT = "comment:";

const llm = scriptedLlm((_req, { said, system, afterTool }) => {
  if (afterTool) return say("Turn done.");
  if (said.startsWith(STAND_IN)) return callTool("s1", "ask_owner", { question: said.slice(STAND_IN.length) });
  if (said.startsWith(WITHDRAW)) return callTool("w1", "ask_owner", { withdraw: said.slice(WITHDRAW.length) });
  if (said.startsWith(COMMENT)) {
    const [task, ...text] = said.slice(COMMENT.length).split("|");
    return callTool("c1", "task_comment", { task, text: text.join("|") });
  }
  if (said.includes("ask me which color")) return callTool("q1", "ask_owner", { question: REAL[0] });
  if (system.startsWith("You are Vera") && said.includes("Quiet check"))
    return say("@owner DISREGARD: no decision requested");
  if (system.startsWith("You are Vera") && said.includes("Loud check"))
    return say("@owner can you confirm the launch date for Friday?");
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
let project = "";
let repo = "";

before(async () => {
  // The turn stops waiting almost at once: the question stays open for a later turn to withdraw.
  env = await startCore({ llm, inputWaits: { turn: 150, external: 150 }, unseenAfterMs: 0 });
  repo = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-owner-q-")));
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Northwind\n");
  project = (await env.client.call("projects.register", { path: repo })).project.id;
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  await removeDir(repo);
});

const inputParts = (messages: Message[]) =>
  messages.flatMap((m) => m.parts.flatMap((p) => (p.type === "input" ? [p] : [])));
const lastToolResult = () => String(llm.calls.at(-1)?.messages.at(-1)?.content);
const inputNotices = async () =>
  (await env.client.call("notifications.list", {})).notifications.filter((n) => n.kind === "input");

test("stand-in questions and notes about other messages are refused; real ones pass", () => {
  for (const q of STAND_INS) assert.ok(ownerQuestionProblem(q), `should refuse: ${q}`);
  for (const q of REAL) assert.equal(ownerQuestionProblem(q), undefined, `should pass: ${q}`);
});

test("ask_owner refuses a stand-in before anything is written or shown to the owner", async () => {
  const before = (await inputNotices()).length;
  for (const q of ["placeholder", "x", "?", "Need update", "DISREGARD: no decision requested", "Ignorá esto"]) {
    const t = await env.client.call("threads.create", { kind: "agent", agent_id: "roby" });
    await env.client.call("threads.send", { thread: t.id, text: `${STAND_IN}${q}` });
    const { messages } = await env.settle(t.id);
    assert.match(lastToolResult(), /invalid arguments for ask_owner: question: not sent: .*Ask one specific question/);
    assert.deepEqual(inputParts(messages), [], q);
    assert.deepEqual((await env.client.call("runs.pending", { thread: t.id })).inputs, [], q);
    assert.equal((await env.client.call("threads.get", { thread: t.id })).thread.state, "idle");
  }
  assert.equal((await inputNotices()).length, before);
});

test("an agent withdraws its own open question: it ends withdrawn, nothing new reaches the owner", async () => {
  const t = await env.client.call("threads.create", { kind: "agent", agent_id: "roby" });
  await env.client.call("threads.send", { thread: t.id, text: "ask me which color" });
  await env.settle(t.id);
  const [input] = (await env.client.call("runs.pending", { thread: t.id })).inputs;
  assert.ok(input);
  assert.match(lastToolResult(), new RegExp(`withdraw=${input.id}`));
  assert.equal((await inputNotices()).filter((n) => n.ref === input.id && !n.read_at).length, 1);

  // Another agent cannot take it back.
  const other = await env.client.call("threads.create", { kind: "agent", agent_id: "vera" });
  await env.client.call("threads.send", { thread: other.id, text: `${WITHDRAW}${input.id}` });
  await env.settle(other.id);
  assert.match(lastToolResult(), /not found/i);
  assert.equal((await env.client.call("runs.pending", { thread: t.id })).inputs.length, 1);

  // Completed unread chats raise their own notices, independently of a question being withdrawn.
  const until = Date.now() + 5000;
  let noticesBefore = 0;
  while (Date.now() < until) {
    const { notifications } = await env.client.call("notifications.list", {});
    if ([t.id, other.id].every((thread) => notifications.some((n) => n.kind === "run" && n.ref === thread))) {
      noticesBefore = notifications.length;
      break;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.ok(noticesBefore, "both completed chats reached the attention tray before withdrawal");
  await env.client.call("threads.send", { thread: t.id, text: `${WITHDRAW}${input.id}` });
  const { messages, runs } = await env.settle(t.id);
  assert.match(lastToolResult(), new RegExp(`Question ${input.id} withdrawn`));
  // The asking turn, the withdrawing one: no turn woken by the withdrawal.
  assert.equal(runs.length, 2);
  assert.deepEqual((await env.client.call("runs.pending", { thread: t.id })).inputs, []);
  const card = inputParts(messages).find((p) => p.input_id === input.id);
  assert.equal(card?.state, "withdrawn");
  assert.equal((await env.client.call("threads.get", { thread: t.id })).thread.state, "idle");
  const { notifications } = await env.client.call("notifications.list", {});
  assert.ok(notifications.filter((n) => n.ref === input.id).every((n) => n.read_at));
  assert.equal(notifications.length, noticesBefore);
  await assert.rejects(env.client.call("runs.respond", { input: input.id, text: "blue" }), /already withdrawn/);

  // Withdrawing it again says it is closed.
  await env.client.call("threads.send", { thread: t.id, text: `${WITHDRAW}${input.id}` });
  await env.settle(t.id);
  assert.match(lastToolResult(), /already withdrawn/);
});

test("an agent's task comment that asks the owner with a stand-in is refused and nothing is posted", async () => {
  const task = await env.client.call("tasks.create", { title: "Pick the venue", project });
  const t = await env.client.call("threads.create", { kind: "agent", agent_id: "roby" });
  const commentsBefore = (await env.client.call("threads.get", { thread: task.thread_id })).messages.length;
  for (const text of ["@owner placeholder", "@owner Need update", "@owner DISREGARD: no decision requested"]) {
    await env.client.call("threads.send", { thread: t.id, text: `${COMMENT}${task.id}|${text}` });
    await env.settle(t.id);
    assert.match(lastToolResult(), /not posted: .*task_update awaits_owner:false/);
  }
  assert.equal((await env.client.call("threads.get", { thread: task.thread_id })).messages.length, commentsBefore);
  assert.equal((await env.client.call("tasks.get", { task: task.id })).task.awaits_owner, false);
  assert.ok(!(await env.client.call("notifications.list", {})).notifications.some((n) => n.ref === task.id));

  // A stand-in without the owner is just a comment; a real question to the owner asks for them.
  await env.client.call("threads.send", { thread: t.id, text: `${COMMENT}${task.id}|x` });
  await env.settle(t.id);
  assert.match(lastToolResult(), /commented/);
  await env.client.call("threads.send", {
    thread: t.id,
    text: `${COMMENT}${task.id}|@owner which of the two venues do you prefer, the north or the south one?`,
  });
  await env.settle(t.id);
  assert.match(lastToolResult(), /commented/);
  assert.equal((await env.client.call("tasks.get", { task: task.id })).task.awaits_owner, true);
});

test("an agent's final answer in a task with a note to the owner posts but does not ask for them", async () => {
  const quiet = await env.client.call("tasks.create", {
    title: "Quiet check",
    description: "Check without asking the owner.",
    project,
    assignee: "vera",
  });
  const loud = await env.client.call("tasks.create", {
    title: "Loud check",
    description: "Ask the owner for approval.",
    project,
    assignee: "vera",
  });
  const settled = async (task: string) => {
    for (let i = 0; i < 200; i++) {
      const { sessions } = await env.client.call("tasks.get", { task });
      const runs = (await Promise.all(sessions.map((s) => env.client.call("threads.get", { thread: s.id })))).flatMap(
        (x) => x.runs,
      );
      if (runs.length && runs.every((r) => r.ended_at)) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("task work did not settle");
  };
  await settled(quiet.id);
  await settled(loud.id);
  assert.equal((await env.client.call("tasks.get", { task: quiet.id })).task.awaits_owner, false);
  assert.equal((await env.client.call("tasks.get", { task: loud.id })).task.awaits_owner, true);
});
