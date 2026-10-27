import assert from "node:assert/strict";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "./engine/testkit.ts";
import { createLog, redactedJson } from "./log.ts";
import { tempDir, waitFor } from "./testkit/platform.ts";

test("nested credential fields and known credential shapes are removed before storage, logs or model input", async () => {
  const folder = tempDir();
  const llm = scriptedLlm(() => say("Done"));
  const env = await startCore({ llm });
  const marker = `apxp_${"a1".repeat(32)}`;
  const payload = {
    message: `See ${marker}`,
    [marker]: { text: "Drop credential-shaped property names" },
    "[redacted]": "Keep an unrelated literal key",
    nested: [{ apiKey: "private-value", authorization: { bearer: "private-object" }, text: "Keep me" }],
    password: "private-password",
  };
  try {
    const project = (await env.client.call("projects.register", { path: folder.path, init: true })).project.id;
    await env.client.call("flows.set", {
      id: "redacted",
      projectId: project,
      name: "Redacted",
      enabled: true,
      predicates: [],
      tableKey: "latest",
      action: { kind: "agent", agent: "roby", prompt: "Summarize event" },
    });
    env.core.store.flows.receive("redacted", "one", payload);
    assert.deepEqual(env.core.store.flows.rows("redacted", 10)[0]?.value, {
      message: "See [redacted]",
      "[redacted]": "Keep an unrelated literal key",
      nested: [{ apiKey: "[redacted]", authorization: "[redacted]", text: "Keep me" }],
      password: "[redacted]",
    });
    const pending = JSON.stringify(env.core.store.flows.pending());
    for (const secret of [marker, "private-value", "private-object", "private-password"])
      assert.equal(pending.includes(secret), false);
    const saved = env.core.store.flows.get("redacted");
    assert.ok(saved);
    await env.client.call("flows.set", saved);
    const event = await waitFor(
      () => env.core.store.flows.events("redacted", 10)[0]?.run_id,
      "redacted event admission",
    );
    await waitFor(() => env.core.store.runs.get(event)?.ended_at, "redacted event completion");
    const run = env.core.store.runs.get(event);
    const history = await env.client.call("threads.get", { thread: run?.thread_id ?? "" });
    const stored = JSON.stringify({ history, calls: llm.calls, events: env.core.store.flows.events("redacted", 10) });
    for (const secret of [marker, "private-value", "private-object", "private-password"])
      assert.equal(stored.includes(secret), false);
    const lines: string[] = [];
    createLog("test", false, (line) => lines.push(line)).warn({ data: JSON.parse(redactedJson(payload)) }, "event");
    assert.equal(lines.join("").includes(marker), false);
    assert.throws(() => env.core.store.flows.receive("redacted", marker, {}), /Invalid event id/);
  } finally {
    await env.core.close();
    await env.cleanup();
    await folder.remove();
  }
});
