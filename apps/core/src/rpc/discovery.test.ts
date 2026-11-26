import assert from "node:assert/strict";
import { test } from "node:test";
import { discoveryState } from "../domain/discovery-state.ts";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";

const START = "2026-05-01T12:00:00.000Z";

test("running core exposes opt-in settings and folds one finding into an existing routine without a second report", async () => {
  let clock = new Date(START);
  const llm = scriptedLlm(() => say("Your morning report, with one researched finding."));
  const env = await startCore({ llm, clock: () => clock, aux: true });
  try {
    const { client, core } = env;
    assert.equal((await client.call("system.health", {})).code_sha, core.identity.code_sha);
    const initial = await client.call("discovery.settings", {});
    assert.equal(initial.settings.enabled, false);
    assert.deepEqual(initial.findings, []);
    const report = await client.call("routines.set", {
      name: "Morning report",
      agent: "superagent",
      schedule: { kind: "every", minutes: 60 },
      prompt: "Summarize my day.",
    });
    const saved = await client.call("discovery.configure", {
      enabled: true,
      delivery: "routine",
      report_routine: report.id,
      expected: initial.settings,
    });
    await assert.rejects(client.call("discovery.configure", { enabled: false, expected: initial.settings }), /changed/);
    assert.equal((await client.call("discovery.settings", {})).settings.report_routine, report.id);
    const noKey = await fetch(`${core.url}/rpc/discovery.configure`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(noKey.status, 400);
    const bad = await fetch(`${core.url}/rpc/discovery.configure`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "invalid-discovery-timezone" },
      body: JSON.stringify({ timezone: "Invalid/Timezone" }),
    });
    assert.equal(bad.status, 400);
    const runtime = discoveryState(core.store, () => clock);
    runtime.write({
      ...runtime.read(),
      findings: [
        {
          id: "finding-1",
          topic: "topic-1",
          title: "A relevant export announcement",
          summary: "Acme announced a format that may help the planned exports.",
          action: "Evaluate it against the requirements.",
          uncertainty: "Not tested.",
          evidence: [
            {
              url: "https://example.com/news",
              title: "Acme news",
              quote: "Acme announced a new export format.",
              read_at: START,
            },
          ],
          found_at: START,
          expires_at: "2026-05-07T12:00:00.000Z",
        },
      ],
    });
    const before = core.store.routines.list().length;
    clock = new Date("2026-05-01T13:01:00.000Z");
    core.scheduler.tick();
    await waitFor(
      async () =>
        (await client.call("routines.runs", { routine: report.id })).runs.some((run) => run.state === "completed"),
      "morning routine completes",
      { ms: 5000 },
    );
    const messages = llm.calls.flatMap((call) => call.messages.map((message) => String(message.content))).join("\n");
    assert.doesNotMatch(
      messages,
      /finding-1|A relevant export announcement/,
      "the finding is composed after the model's report",
    );
    const runs = (await client.call("routines.runs", { routine: report.id })).runs;
    const reportChat = await client.call("threads.get", { thread: runs[0]?.thread_id ?? "" });
    const delivered = reportChat.messages
      .flatMap((message) => message.parts)
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n");
    assert.equal(delivered.match(/A relevant export announcement/g)?.length, 1);
    assert.match(delivered, /https:\/\/example.com\/news/);
    assert.equal(core.store.routines.list().length, before);
    assert.ok((await client.call("discovery.settings", {})).findings[0]?.included_at);
    const feedback = await client.call("discovery.feedback", { finding: "finding-1", feedback: "mute" });
    assert.equal(feedback.findings[0]?.feedback, "mute");
    assert.equal(saved.settings.enabled, true);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
