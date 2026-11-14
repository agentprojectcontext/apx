// Claude's own tool calls are recorded by how they ended: a call shows as running until its result comes back, and
// a result the SDK marks as an error is a failed step, not a done one.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { tempDir } from "../testkit/platform.ts";
import { claudeHarness } from "./claude.ts";

test("a Claude edit whose result is an error is recorded as failed, one that worked as done", async () => {
  await using dir = tempDir("apx-claude-result-");
  const bin = path.join(dir.path, "claude.js");
  const use = (id: string, file: string) => ({
    type: "tool_use",
    id,
    name: "Edit",
    input: { file_path: path.join(dir.path, file), old_string: "a", new_string: "b" },
  });
  const events = [
    { type: "system", subtype: "init", model: "fixture-model", session_id: "s1" },
    {
      type: "assistant",
      parent_tool_use_id: null,
      session_id: "s1",
      message: {
        id: "m1",
        role: "assistant",
        model: "fixture-model",
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [use("bad-edit", "missing.ts"), use("good-edit", "there.ts")],
      },
    },
    {
      type: "user",
      parent_tool_use_id: null,
      session_id: "s1",
      message: {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "bad-edit", is_error: true, content: "File not found." },
          { type: "tool_result", tool_use_id: "good-edit", content: "Edited." },
        ],
      },
    },
    {
      type: "result",
      subtype: "success",
      result: "One edit failed.",
      session_id: "s1",
      modelUsage: {},
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  ];
  fs.writeFileSync(
    bin,
    `const readline = require("node:readline");
const send = (v) => process.stdout.write(JSON.stringify(v) + "\\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.type === "control_request")
    send({ type: "control_response", response: { subtype: "success", request_id: m.request_id, response: {} } });
  else if (m.type === "user") for (const e of ${JSON.stringify(events)}) send(e);
});
`,
  );
  const harness = claudeHarness({ claudePath: async () => bin, cwd: () => dir.path, readImage: () => undefined });
  const env = await startCore({ llm: scriptedLlm(() => say("unused")), harnesses: { claude: harness } });
  try {
    const { project } = await env.client.call("projects.register", { path: dir.path, init: true });
    const thread = await env.client.call("threads.create", {
      kind: "code",
      agent_id: "superagent",
      project_id: project.id,
      engine: "claude",
      write: "auto",
    });
    await env.client.call("threads.send", { thread: thread.id, text: "edit the two files" });
    const done = await env.settle(thread.id);
    const steps = done.runs.flatMap((r) => env.core.store.runs.steps(r.id));
    const state = (id: string) => steps.find((s) => s.call_id === id)?.state;
    assert.equal(state("bad-edit"), "error");
    assert.equal(state("good-edit"), "ok");
    const card = done.messages.flatMap((m) => m.parts).find((p) => p.type === "tool" && p.call_id === "bad-edit");
    assert.equal(card?.type === "tool" ? card.status : undefined, "error");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
