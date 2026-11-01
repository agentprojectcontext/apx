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
    assert.equal(waiting.messages.at(-1)?.model_reported, true);
    await client.call("threads.cancel", { thread: thread.id });
    done = await env.settle(thread.id);
    assert.equal(done.messages.at(-1)?.model, "claude/reported-b");
    const reloaded = await client.call("threads.get", { thread: thread.id });
    assert.equal(reloaded.messages.at(-1)?.model, "claude/reported-b");
    assert.equal(reloaded.messages.at(-1)?.model_reported, true);
    assert.equal(reloaded.messages.find((m) => m.model === "claude/reported-a")?.model_reported, true);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

for (const kind of ["stream_event", "assistant"] as const) {
  test(`Claude ${kind} updates the main model without trusting child or synthetic models`, async () => {
    await using dir = tempDir("apx-model-report-");
    const bin = path.join(dir.path, "claude.js");
    const event = (model: string, parent: string | null) => {
      const message = { id: `${model}-${parent}`, model, content: [], usage: { input_tokens: 1, output_tokens: 1 } };
      return kind === "assistant"
        ? { type: kind, parent_tool_use_id: parent, message, session_id: "fixture-session" }
        : { type: kind, parent_tool_use_id: parent, event: { type: "message_start", message } };
    };
    const events = [
      { type: "system", subtype: "init", model: "initial", session_id: "fixture-session" },
      event("reported-main", null),
      event("nested-child", "parent-tool"),
      event("<synthetic>", null),
      {
        type: "result",
        subtype: "success",
        result: "Done",
        session_id: "fixture-session",
        modelUsage: {},
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    ];
    fs.writeFileSync(
      bin,
      `
const readline = require("node:readline");
const send = (v) => process.stdout.write(JSON.stringify(v) + "\\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.type === "control_request") send({ type: "control_response", response: { subtype: "success", request_id: m.request_id, response: {} } });
  else if (m.type === "user") for (const event of ${JSON.stringify(events)}) send(event);
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
      });
      await env.client.call("threads.send", { thread: thread.id, text: "finish" });
      const done = await env.settle(thread.id);
      assert.equal(done.runs[0]?.state, "completed");
      assert.equal(done.messages.at(-1)?.model, "claude/reported-main");
      assert.equal(done.messages.at(-1)?.model_reported, true);
    } finally {
      await env.core.close();
      await env.cleanup();
    }
  });
}

test("requested models, effort and startup aliases do not confirm a Claude model", async () => {
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
  else if (m.type === "user") {
    for (const model of ["default", "opus", "sonnet", "haiku", "sonnet[1m]", "opusplan", "<synthetic>"])
      send({ type: "system", subtype: "init", model, session_id: "fixture-session" });
    send({ type: "result", subtype: "success", result: "Done", session_id: "fixture-session", modelUsage: {}, usage: { input_tokens: 1, output_tokens: 1 } });
  }
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
    assert.equal(done.messages.at(-1)?.model_reported, undefined);
    assert.equal(done.runs[0]?.model, undefined);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

for (const retry of ["finish", "wait", "report"]) {
  test(`a lost Claude session clears its failed model before a fresh attempt can ${retry}`, async () => {
    await using dir = tempDir("apx-model-retry-");
    const bin = path.join(dir.path, "claude.js");
    fs.writeFileSync(
      bin,
      `
const fs = require("node:fs");
const readline = require("node:readline");
const send = (v) => process.stdout.write(JSON.stringify(v) + "\\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.type === "control_request") send({ type: "control_response", response: { subtype: "success", request_id: m.request_id, response: {} } });
  else if (m.type === "user") {
    const resumed = process.argv.some((arg) => arg.startsWith("--resume="));
    const marker = __filename + ".started";
    if (resumed) {
      send({ type: "system", subtype: "init", model: "abandoned", session_id: "lost-session" });
      send({ type: "result", subtype: "error_session_not_found", session_id: "lost-session", modelUsage: {}, usage: {} });
    } else {
      if (!fs.existsSync(marker)) {
        fs.writeFileSync(marker, "started");
        send({ type: "system", subtype: "init", model: "established", session_id: "fixture-session" });
      } else if (${JSON.stringify(retry)} === "report") {
        send({ type: "system", subtype: "init", model: "replacement", session_id: "fresh-session" });
      } else if (${JSON.stringify(retry)} === "wait") {
        send({ type: "control_request", request_id: "permission", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "rm -f output.wav" } } });
        return;
      }
      send({ type: "result", subtype: "success", result: "Done", session_id: "fresh-session", modelUsage: {}, usage: { input_tokens: 1, output_tokens: 1 } });
    }
  }
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
      });
      await env.client.call("threads.send", { thread: thread.id, text: "establish" });
      const first = await env.settle(thread.id);
      assert.equal(first.messages.at(-1)?.model_reported, true);
      await env.client.call("threads.send", { thread: thread.id, text: retry });
      if (retry === "wait") {
        await waitFor(
          async () => (await env.client.call("runs.pending", { thread: thread.id })).inputs[0],
          "fresh session permission",
        );
        const pending = await env.client.call("threads.get", { thread: thread.id });
        assert.notEqual(pending.messages.at(-1)?.model_reported, true);
        assert.equal(pending.messages.at(-1)?.model, undefined);
        await env.client.call("threads.cancel", { thread: thread.id });
      }
      const done = await env.settle(thread.id);
      if (retry !== "wait") assert.equal(done.runs.at(-1)?.state, "completed");
      assert.equal(done.messages.at(-1)?.model, retry === "report" ? "claude/replacement" : undefined);
      assert.equal(done.messages.at(-1)?.model_reported, retry === "report");
      assert.equal(done.messages.find((m) => m.model === "claude/established")?.model_reported, true);
    } finally {
      await env.core.close();
      await env.cleanup();
    }
  });
}
