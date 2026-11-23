// A Claude Code session takes the owner's words mid-turn, as our own loop does (DECISIONS.md#d-196): Enter folds them
// into the running turn after its tool round, "Send now" stops the step it is on; either way the same session and run.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { Message } from "@apx/protocol";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { tempDir, waitFor } from "../testkit/platform.ts";
import { claudeHarness } from "./claude.ts";

/**
 * A stand-in `claude` reading stream-json on stdin. A first prompt asking to run something waits for the command's
 * approval, then reports the command and its result. Later prompts answer with every prompt this one process read (a
 * new process would show only one), listing the ones its turn took, as the CLI does.
 */
const FAKE = `
const readline = require("node:readline");
const send = (v) => process.stdout.write(JSON.stringify(v) + "\\n");
const session_id = "fixture-session";
const usage = { input_tokens: 1, output_tokens: 1 };
const said = (m) => typeof m.message.content === "string" ? m.message.content : m.message.content.map((b) => b.text ?? "").join("");
const prompts = [];
const answer = (subtype, result, ids) =>
  send({ type: "result", subtype, result, session_id, modelUsage: {}, usage, user_message_uuids: ids });
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.type === "control_request") {
    send({ type: "control_response", response: { subtype: "success", request_id: m.request_id, response: {} } });
  } else if (m.type === "control_response" && m.response.request_id === "permission") {
    const content = [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "rm -f output.wav" } }];
    send({ type: "assistant", parent_tool_use_id: null, session_id, message: { id: "m1", model: "reported", content, usage } });
    send({ type: "user", parent_tool_use_id: null, session_id, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "" }] } });
  } else if (m.type === "user") {
    prompts.push(m);
    if (prompts.length === 1) {
      send({ type: "system", subtype: "init", model: "reported", session_id });
      if (said(m).includes("run"))
        send({ type: "control_request", request_id: "permission", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "rm -f output.wav" } } });
    } else if (m.priority === "now") {
      // The step it was on stops; the words run next, in the same session.
      answer("error_during_execution", undefined, [prompts[0].uuid]);
      send({ type: "system", subtype: "init", model: "reported", session_id });
      answer("success", "Now: " + prompts.map(said).join(" | "), [m.uuid]);
    } else {
      answer("success", "Folded: " + prompts.map(said).join(" | "), prompts.map((p) => p.uuid));
    }
  }
});
`;

const said = (m: Message | undefined) => (m?.parts ?? []).flatMap((p) => (p.type === "text" ? [p.text] : [])).join(" ");

async function claudeSession() {
  const dir = tempDir("apx-claude-steer-");
  const bin = path.join(dir.path, "claude.js");
  fs.writeFileSync(bin, FAKE);
  const harness = claudeHarness({ claudePath: async () => bin, cwd: () => dir.path, readImage: () => undefined });
  const env = await startCore({ llm: scriptedLlm(() => say("ok")), harnesses: { claude: harness } });
  const { project } = await env.client.call("projects.register", { path: dir.path, init: true });
  const thread = await env.client.call("threads.create", {
    kind: "code",
    agent_id: "superagent",
    project_id: project.id,
    engine: "claude",
  });
  return {
    env,
    thread: thread.id,
    async [Symbol.asyncDispose]() {
      await env.core.close();
      await env.cleanup();
      await dir.remove();
    },
  };
}

test("Enter while Claude Code works joins its turn after the tool round, in the same session and run", async () => {
  await using s = await claudeSession();
  const { env, thread } = s;
  const first = await env.client.call("threads.send", { thread, text: "run the cleanup" });
  const ask = await waitFor(
    async () => (await env.client.call("runs.pending", { thread })).inputs[0],
    "the command's approval",
  );

  const entered = await env.client.call("threads.send", { thread, text: "use metric", mode: "steer" });
  assert.equal(entered.steered, true);
  assert.equal(entered.run.id, first.run.id);
  assert.deepEqual(env.core.store.messages.get(entered.message.id)?.waiting, { until: "step" });
  // Not stopped: still waiting on the owner's answer about the command.
  assert.equal(env.core.store.runs.get(first.run.id)?.state, "input-required");

  await env.client.call("runs.respond", { input: ask.id, decision: "approve" });
  const { messages, runs } = await env.settle(thread);

  assert.deepEqual(
    runs.map((r) => [r.id, r.state]),
    [[first.run.id, "completed"]],
  );
  assert.match(
    said(messages.filter((m) => m.author.kind === "agent").at(-1)),
    /^Folded: run the cleanup \| .*use metric$/s,
  );
  assert.ok(messages.every((m) => !m.waiting));
});

test("Send now on Claude Code stops the step it is on and runs the words next, in the same session and run", async () => {
  await using s = await claudeSession();
  const { env, thread } = s;
  const first = await env.client.call("threads.send", { thread, text: "think it over" });
  // The session is up (it reported its model): the turn is at work and listens for "send now".
  await waitFor(async () => {
    const t = await env.client.call("threads.get", { thread });
    return t.messages.at(-1)?.model === "claude/reported";
  }, "the Claude session");

  const entered = await env.client.call("threads.send", { thread, text: "stop and list files", mode: "steer" });
  assert.equal(entered.steered, true);
  assert.deepEqual(await env.client.call("runs.send_now", { message: entered.message.id }), { now: true });
  const { messages, runs } = await env.settle(thread);

  assert.deepEqual(
    runs.map((r) => [r.id, r.state]),
    [[first.run.id, "completed"]],
  );
  assert.match(
    said(messages.filter((m) => m.author.kind === "agent").at(-1)),
    /^Now: think it over \| .*stop and list files$/s,
  );
  assert.ok(messages.every((m) => !m.waiting));
});
