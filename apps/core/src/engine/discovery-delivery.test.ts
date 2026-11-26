import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeTelegram } from "../channels/fake-telegram.test-support.ts";
import { telegramAdapter } from "../channels/telegram.ts";
import { discoveryState } from "../domain/discovery-state.ts";
import { waitFor } from "../testkit/platform.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

const AT = "2030-05-01T12:00:00.000Z";
for (const mode of ["base", "quiet", "failed", "self-send"] as const) {
  test(`the actual report delivery composes one finding (${mode})`, async () => {
    const tg = await fakeTelegram("123456:TEST-token");
    const llm = scriptedLlm((_request, { afterTool }) => {
      if (mode === "failed") throw new Error("fixture model failure");
      if (mode === "quiet") return say("SKIP");
      if (mode === "self-send")
        return afterTool ? say("SKIP") : callTool("m1", "message_contact", { to: "me", text: "Base self report" });
      return say("Base report");
    });
    const env = await startCore({
      llm,
      clock: () => new Date(AT),
      channelAdapters: { telegram: (c, t) => telegramAdapter(c, t, tg.url) },
    });
    try {
      await env.client.call("channels.set", {
        id: "tg",
        channel: { type: "telegram", agent_id: "superagent" },
        token: "123456:TEST-token",
      });
      env.core.store.persons.link(env.core.store.persons.owner().id, { channel: "tg", external_id: "1001" });
      await waitFor(
        async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running",
        "fixture channel running",
      );
      const report = await env.client.call("routines.set", {
        name: "Morning report",
        agent: "superagent",
        schedule: { kind: "manual" },
        prompt: "Return the usual report.",
      });
      const state = discoveryState(env.core.store, () => new Date(AT));
      state.configure({ enabled: true, delivery: "routine", report_routine: report.id });
      state.write({
        ...state.read(),
        findings: [
          {
            id: "finding",
            topic: "topic",
            title: "A supported change worth evaluating",
            summary: "The official page describes a useful change for the workflow.",
            action: "Compare it with the requirements.",
            uncertainty: "Compatibility is untested.",
            evidence: [
              {
                url: "https://example.com/news",
                title: "Acme news",
                quote: "Acme announced a useful change.",
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
        async () => (await env.client.call("routines.runs", { routine: report.id })).runs[0]?.delivered !== undefined,
        "report ended",
      );
      await waitFor(() => tg.messagesTo(1001).length > 0, "report reached its existing channel");
      const sent = tg
        .messagesTo(1001)
        .map((message) => String(message.body.text))
        .join("\n");
      assert.equal(tg.messagesTo(1001).length, 1, "no second report is posted");
      if (mode === "failed") {
        assert.doesNotMatch(sent, /supported change worth evaluating/);
        assert.equal(state.read().findings[0]?.included_at, undefined);
      } else {
        assert.equal(sent.match(/A supported change worth evaluating/g)?.length, 1);
        assert.match(sent, /https:\/\/example.com\/news/);
        assert.ok(state.read().findings[0]?.included_at);
        assert.doesNotMatch(
          JSON.stringify(llm.calls[0]?.messages),
          /supported change worth evaluating/,
          "the model cannot duplicate the reserved finding in its own answer",
        );
        if (mode === "quiet") {
          const { thread, messages } = await env.client.call("threads.get", { thread: run.thread_id });
          assert.equal(thread.archived ?? false, false, "the finding itself makes the usual report useful");
          assert.match(JSON.stringify(messages), /supported change worth evaluating/);
        }
      }
      await env.client.call("routines.run", { routine: report.id });
      await waitFor(
        async () =>
          (await env.client.call("routines.runs", { routine: report.id })).runs.every(
            (item) => item.delivered !== undefined,
          ),
        "manual repeat ended",
      );
      assert.equal(state.read().claims.length, 1, "manual repeats cannot reserve another finding that day");
    } finally {
      await env.core.close();
      await tg.close();
      await env.cleanup();
    }
  });
}
