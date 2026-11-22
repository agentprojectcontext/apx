import assert from "node:assert/strict";
import { test } from "node:test";
import { discoveryState } from "../domain/discovery-state.ts";
import { waitFor } from "../testkit/platform.ts";
import { discoveryReplyContext } from "./discovery-reply.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

const AT = "2030-05-01T12:00:00.000Z";
test("an owner can rate the composed report through the settings tool; its finding remains a user observation, not assistant history", async () => {
  let feedbackStep = 0;
  const title = "A useful official export announcement";
  const llm = scriptedLlm((request) => {
    const feedbackTurn = request.messages.some(
      (message) => message.role === "user" && String(message.content).includes("Mute this topic"),
    );
    if (!feedbackTurn) return say("SKIP");
    const observations = request.messages
      .filter((message) => message.role === "user")
      .map((message) => String(message.content))
      .join("\n");
    assert.match(observations, /research_finding/);
    assert.match(observations, /discovery\.feedback/);
    assert.match(observations, /A useful official export announcement/);
    assert.doesNotMatch(
      request.messages
        .filter((message) => message.role === "assistant")
        .map((message) => String(message.content))
        .join("\n"),
      /A useful official export announcement/,
    );
    if (feedbackStep++ === 0)
      return callTool("search", "tool_search", { query: "apx_settings contextual research feedback" });
    if (feedbackStep === 2)
      return callTool("feedback", "apx_settings", {
        method: "discovery.feedback",
        params: { finding: "finding", feedback: "mute" },
      });
    return say("This topic is muted.");
  });
  const env = await startCore({ llm, clock: () => new Date(AT) });
  try {
    const report = await env.client.call("routines.set", {
      name: "Morning report",
      agent: "superagent",
      schedule: { kind: "manual" },
      prompt: "Return the usual report.",
    });
    const state = discoveryState(env.core.store, () => new Date(AT));
    state.configure({ enabled: true, report_routine: report.id });
    state.write({
      ...state.read(),
      findings: [
        {
          id: "finding",
          topic: "topic",
          title,
          summary: "Acme's new format may help the planned exports.",
          action: "Evaluate it against the requirements.",
          uncertainty: "Compatibility remains untested.",
          evidence: [
            {
              url: "https://example.com/news",
              title: "Acme news",
              quote: "Acme announced a useful export format.",
              read_at: AT,
            },
          ],
          found_at: AT,
          expires_at: "2030-05-07T12:00:00.000Z",
        },
      ],
    });
    const run = await env.client.call("routines.run", { routine: report.id });
    await waitFor(
      async () => (await env.client.call("routines.runs", { routine: report.id })).runs[0]?.delivered === true,
      "composed report ready",
    );
    assert.equal(discoveryReplyContext(env.core.store, "other-chat", "superagent"), undefined);
    assert.equal(discoveryReplyContext(env.core.store, run.thread_id, "other-agent"), undefined);
    await env.client.call("threads.send", { thread: run.thread_id, text: "Mute this topic" });
    await waitFor(() => env.core.store.inputs.pending(run.thread_id)[0], "feedback confirmation");
    const input = env.core.store.inputs.pending(run.thread_id)[0];
    assert.ok(input);
    assert.equal(input.tool, "apx_settings");
    assert.equal(input.args?.method, "discovery.feedback");
    assert.equal(state.read().findings[0]?.feedback, undefined, "no preference changes before confirmation");
    await env.client.call("runs.respond", { input: input.id, decision: "approve" });
    const settled = await env.settle(run.thread_id);
    assert.equal(settled.runs.at(-1)?.state, "completed");
    assert.equal(feedbackStep, 3);
    assert.equal(state.read().findings[0]?.feedback, "mute");
    assert.deepEqual(state.read().muted, ["topic"]);
    state.configure({ enabled: false });
    assert.equal(
      discoveryReplyContext(env.core.store, run.thread_id, "superagent"),
      undefined,
      "revoked research evidence is not replayed",
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
