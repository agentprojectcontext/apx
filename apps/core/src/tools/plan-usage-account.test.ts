import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { fakeProgram } from "../harness/fake-program.test-support.ts";
import { tempDir } from "../testkit/platform.ts";

test("enabled quota windows reach the agent through a CLI process and opt-out hides the cached report", async () => {
  await using dir = tempDir();
  const program = fakeProgram(
    dir.path,
    "codex",
    `
    if (argv[0] === "app-server") {
      const lines = require("node:readline").createInterface({ input: process.stdin });
      lines.on("line", line => {
        const frame = JSON.parse(line);
        if (frame.method === "initialize") process.stdout.write(JSON.stringify({id: frame.id, result: {}}) + "\\n");
        if (frame.method === "account/rateLimits/read") process.stdout.write(JSON.stringify({id: frame.id, result: {rateLimits: {
          primary: {usedPercent: 0, windowDurationMins: 300, resetsAt: 1800000000},
          secondary: {usedPercent: 90, windowDurationMins: 10080, resetsAt: null}
        }}}) + "\\n");
      });
    } else console.log("fixture");
  `,
  );
  const oldPath = process.env.PATH;
  const oldOptions = process.env.NODE_OPTIONS;
  process.env.PATH = [dir.path, oldPath].filter(Boolean).join(path.delimiter);
  if (program.env.NODE_OPTIONS) process.env.NODE_OPTIONS = program.env.NODE_OPTIONS;
  const llm = scriptedLlm((req, { afterTool }) =>
    afterTool ? say(String(req.messages.at(-1)?.content)) : callTool("quota", "plan_usage", { query: "ChatGPT" }),
  );
  let env: Awaited<ReturnType<typeof startCore>> | undefined;
  try {
    env = await startCore({ llm });
    await env.client.call("engines.set_usage", { engine: "codex", enabled: true });
    const thread = await env.client.call("threads.create", { kind: "loose", agent_id: "superagent" });
    const ask = async () => {
      assert.ok(env);
      await env.client.call("threads.send", { thread: thread.id, text: "Check my ChatGPT account quotas" });
      const { messages } = await env.settle(thread.id);
      return messages.at(-1)?.parts.find((part) => part.type === "text")?.text ?? "";
    };
    const answer = await ask();
    const result = JSON.parse(answer.split("\n")[1] ?? "");
    assert.equal(result.matched, true);
    assert.equal(result.engines[0].status, "ok");
    assert.deepEqual(result.engines[0].windows, [
      { id: "primary", used_percent: 0, window_minutes: 300, resets_at: new Date(1800000000000).toISOString() },
      { id: "secondary", used_percent: 90, window_minutes: 10080 },
    ]);
    assert.ok(Number.isFinite(Date.parse(result.checked_at)));
    await env.client.call("engines.set_usage", { engine: "codex", enabled: false });
    // Another enabled engine keeps the tool offered while the opted-out report is hidden.
    await env.client.call("engines.set_usage", { engine: "acp:cursor", enabled: true });
    const hidden = JSON.parse((await ask()).split("\n")[1] ?? "");
    assert.deepEqual(hidden.engines, []);
    assert.equal(hidden.matched, false);
  } finally {
    await env?.core.close();
    await env?.cleanup();
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    if (oldOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = oldOptions;
  }
});
