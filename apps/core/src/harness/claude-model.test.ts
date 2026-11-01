import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { tempDir, waitFor } from "../testkit/platform.ts";
import { claudeHarness } from "./claude.ts";

test("Claude reports its model before approval, keeps it after cancellation and updates it on resume", async () => {
  await using dir = tempDir("apx-model-sdk-");
  const bin = path.join(dir.path, "claude.js");
  fs.writeFileSync(
    bin,
    `
const readline = require("node:readline");
const send = (v) => process.stdout.write(JSON.stringify(v) + "\\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.type === "control_request") {
    send({ type: "control_response", response: { subtype: "success", request_id: m.request_id, response: {} } });
  } else if (m.type === "user") {
    const resumed = process.argv.some((arg) => arg.startsWith("--resume="));
    send({ type: "system", subtype: "init", model: resumed ? "reported-b" : "reported-a", session_id: "fixture-session" });
    if (JSON.stringify(m.message.content).includes("wait")) {
      send({ type: "control_request", request_id: "permission", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "rm -f output.wav" } } });
    } else {
      send({ type: "result", subtype: "success", result: "Done", session_id: "fixture-session", modelUsage: {}, usage: { input_tokens: 1, output_tokens: 1 } });
    }
  }
});
`,
  );
  const harness = claudeHarness({ claudePath: async () => bin, cwd: () => dir.path, readImage: () => undefined });
  const env = await startCore({ llm: scriptedLlm(() => say("ok")), harnesses: { claude: harness } });
  try {
    const { client } = env;
    const { project } = await client.call("projects.register", { path: dir.path, init: true });
    const thread = await client.call("threads.create", {
      kind: "code",
      agent_id: "superagent",
      project_id: project.id,
      engine: "claude",
    });
    await client.call("threads.send", { thread: thread.id, text: "finish" });
    let done = await env.settle(thread.id);
    assert.equal(done.messages.at(-1)?.model, "claude/reported-a");
    await client.call("threads.send", { thread: thread.id, text: "wait" });
    await waitFor(async () => {
      const current = await client.call("threads.get", { thread: thread.id });
      const last = current.runs.at(-1);
      assert.notEqual(last?.state, "failed", JSON.stringify(current));
      return (await client.call("runs.pending", { thread: thread.id })).inputs[0];
    }, "Claude permission");
    const waiting = await client.call("threads.get", { thread: thread.id });
    assert.equal(waiting.messages.at(-1)?.model, "claude/reported-b");
    await client.call("threads.cancel", { thread: thread.id });
    done = await env.settle(thread.id);
    assert.equal(done.messages.at(-1)?.model, "claude/reported-b");
    const reloaded = await client.call("threads.get", { thread: thread.id });
    assert.equal(reloaded.messages.at(-1)?.model, "claude/reported-b");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a requested Claude model and effort are not evidence when the engine reports neither", async () => {
  await using dir = tempDir("apx-model-unknown-");
  const bin = path.join(dir.path, "claude.js");
  fs.writeFileSync(
    bin,
    `
const readline = require("node:readline");
const send = (v) => process.stdout.write(JSON.stringify(v) + "\\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.type === "control_request") send({ type: "control_response", response: { subtype: "success", request_id: m.request_id, response: {} } });
  else if (m.type === "user") send({ type: "result", subtype: "success", result: "Done", session_id: "fixture-session", modelUsage: {}, usage: { input_tokens: 1, output_tokens: 1 } });
});
`,
  );
  const harness = claudeHarness({ claudePath: async () => bin, cwd: () => dir.path, readImage: () => undefined });
  const env = await startCore({ llm: scriptedLlm(() => say("ok")), harnesses: { claude: harness } });
  try {
    const { project } = await env.client.call("projects.register", { path: dir.path, init: true });
    const thread = await env.client.call("threads.create", {
      kind: "code",
      agent_id: "superagent",
      project_id: project.id,
      engine: "claude",
      model: "claude/claude-opus-5-5#medium",
    });
    await env.client.call("threads.send", { thread: thread.id, text: "finish" });
    const done = await env.settle(thread.id);
    assert.equal(done.runs[0]?.state, "completed");
    assert.equal(done.messages.at(-1)?.model, undefined);
    assert.equal(done.runs[0]?.model, undefined);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
