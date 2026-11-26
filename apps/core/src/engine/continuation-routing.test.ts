import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { waitFor } from "../testkit/platform.ts";
import { defineTool } from "../tools/types.ts";
import { moveHome } from "./home-channel.ts";
import { callTool, say, scriptedLlm, startCore } from "./testkit.ts";

const start = Date.parse("2026-10-05T10:00:00Z");
const at = (minutes: number) => new Date(start + minutes * 60_000).toISOString();
const original = { channel: "first", conversation: "1001" };
const changed = { channel: "second", conversation: "1001" };
const result = "The bounded follow-up result";

for (const route of ["moveHome", "sendNow", "steer"] as const) {
  for (const destination of [original, null]) {
    test(`${route} cannot retarget a running follow-up admitted ${destination ? "on a channel" : "in app only"}`, async () => {
      let release = () => {};
      let holding = false;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const hold = defineTool({
        name: "hold_followup",
        description: "Wait for the test's release or step cancellation",
        args: z.object({}),
        effect: "none",
        confirm: "never",
        deadlineMs: 60_000,
        title: () => "Holding",
        run: async (_args, ctx) => {
          holding = true;
          await Promise.race([
            gate,
            new Promise<void>((resolve) => ctx.signal.addEventListener("abort", () => resolve(), { once: true })),
          ]);
          return "ready";
        },
      });
      const llm = scriptedLlm((_req, { afterTool, said }) => {
        if (afterTool || said.startsWith("[The owner adds")) return say(result);
        return callTool("hold", "hold_followup", {});
      });
      let clock = new Date(start);
      const sent: Array<{ channel: string; conversation: string; text: string }> = [];
      const f = await startCore({
        llm,
        clock: () => clock,
        extraTools: [hold],
        channelAdapters: {
          telegram: (config) => ({
            caps: { typing: false, buttons: false },
            start: async () => ({ account: "test" }),
            stop: async () => {},
            send: async (conversation, p) => {
              sent.push({ channel: config.id, conversation, text: p.text });
              return {};
            },
          }),
        },
      });
      try {
        for (const id of ["first", "second"]) {
          await f.client.call("channels.set", {
            id,
            channel: { type: "telegram", agent_id: "superagent", concurrency: "queue" },
            token: `123456:TEST-${id}`,
          });
          f.core.store.persons.link(f.core.store.persons.owner().id, { channel: id, external_id: "1001" });
        }
        f.core.store.settings.write("notices", { ...f.core.store.settings.read("notices"), channel: "auto" });
        f.core.store.threads.mergeContext("home", { reply_to: destination ?? undefined });
        const item = await f.client.call("continuations.create", {
          thread: "home",
          purpose: "Read only this report",
          condition: { kind: "time", at: at(10) },
          expires_at: at(60),
        });
        clock = new Date(at(10));
        f.core.scheduler.tick();
        await waitFor(() => holding, "the continuation tool to be running");
        const runId = f.core.store.continuations.get(item.id)?.value.run_id;
        assert.ok(runId);
        assert.deepEqual(f.core.store.runs.get(runId)?.input?.reply_to, destination);
        if (route === "moveHome") moveHome(f.core.store, changed);
        else {
          f.core.store.threads.mergeContext("home", { reply_to: changed });
          const next = await f.client.call("threads.send", {
            thread: "home",
            text: "Keep the answer brief",
            mode: route === "sendNow" ? "queue" : "steer",
          });
          if (route === "sendNow") {
            f.core.store.runs.setReplyTo(next.run.id, changed);
            assert.deepEqual(f.core.store.runs.get(next.run.id)?.input?.reply_to, changed);
            assert.deepEqual(await f.client.call("runs.send_now", { message: next.message.id }), { now: true });
          } else assert.equal(next.steered, true);
        }
        if (route === "moveHome") assert.deepEqual(f.core.store.threads.context("home").reply_to, changed);
        assert.deepEqual(f.core.store.runs.get(runId)?.input?.reply_to, destination);
        release();
        await f.settle("home");
        assert.equal(f.core.store.continuations.get(item.id)?.value.state, "completed");
        if (destination) {
          await waitFor(() => sent.some((s) => s.text.includes(result)), "the actual channel delivery");
          assert.ok(
            sent
              .filter((s) => s.text.includes(result))
              .every((s) => s.channel === destination.channel && s.conversation === destination.conversation),
          );
        } else {
          assert.deepEqual(f.core.store.runs.get(runId)?.input?.reply_to, null);
          assert.ok(!sent.some((s) => s.text.includes(result)), "an app-only follow-up stays off both channels");
        }
      } finally {
        release();
        await f.core.close();
        await f.cleanup();
      }
    });
  }
}
