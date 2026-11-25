import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { samePath } from "../paths.ts";
import { tempDir } from "../testkit/platform.ts";
import { claudeHarness } from "./claude.ts";

test("a removed code folder reports the folder problem and can resume in the same session", async () => {
  await using dir = tempDir("apx-claude-folder-");
  const cwd = path.join(dir.path, "checkout");
  fs.mkdirSync(cwd);
  const bin = path.join(dir.path, "fixture.js");
  fs.writeFileSync(
    bin,
    `
const readline = require("node:readline");
const send = (v) => process.stdout.write(JSON.stringify(v) + "\\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.type === "control_request") send({ type: "control_response", response: { subtype: "success", request_id: m.request_id, response: {} } });
  else if (m.type === "user") {
    send({ type: "system", subtype: "init", session_id: "fixture-session" });
    send({ type: "result", subtype: "success", result: process.argv.some((a) => a.includes("--resume")) ? "Resumed" : "Started", session_id: "fixture-session", modelUsage: {}, usage: { input_tokens: 1, output_tokens: 1 } });
  }
});
`,
  );
  let env: Awaited<ReturnType<typeof startCore>>;
  const harness = claudeHarness({
    claudePath: async () => bin,
    cwd: (io) => env.core.store.threads.get(io.thread.id)?.cwd ?? dir.path,
    readImage: () => undefined,
  });
  env = await startCore({ llm: scriptedLlm(() => say("ok")), harnesses: { claude: harness } });
  try {
    const { client } = env;
    const { project } = await client.call("projects.register", { path: dir.path, init: true });
    const thread = await client.call("threads.create", {
      kind: "code",
      agent_id: "superagent",
      project_id: project.id,
      cwd,
      engine: "claude",
      write: "read-only",
    });
    await client.call("threads.send", { thread: thread.id, text: "Say hello" });
    const started = await env.settle(thread.id);
    assert.equal(started.runs[0]?.state, "completed", JSON.stringify(started.runs));
    fs.rmdirSync(cwd);
    await client.call("threads.send", { thread: thread.id, text: "Say hello again" });
    const failed = await env.settle(thread.id);
    assert.equal(failed.runs[0]?.state, "failed");
    assert.match(failed.runs[0]?.error ?? "", /working folder is not available/);
    assert.equal(fs.existsSync(cwd), false, "never recreate a removed checkout");
    const fixed = await client.call("threads.update", { thread: thread.id, cwd: dir.path });
    assert.equal(fixed.id, thread.id);
    assert.equal(fixed.write, "read-only");
    assert.ok(samePath(fixed.cwd ?? "", dir.path));
    await client.call("threads.send", { thread: thread.id, text: "Say hello once more" });
    const resumed = await env.settle(thread.id);
    assert.equal(resumed.runs[0]?.state, "completed");
    assert.ok(resumed.messages.at(-1)?.parts.some((p) => p.type === "text" && p.text.includes("Resumed")));
    assert.equal((await client.call("threads.list", {})).threads.filter((t) => t.kind === "code").length, 1);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
