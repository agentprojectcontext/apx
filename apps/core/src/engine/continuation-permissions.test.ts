import assert from "node:assert/strict";
import { test } from "node:test";
import { ApxClient } from "@apx/protocol/client";
import { z } from "zod";
import { waitFor } from "../testkit/platform.ts";
import { defineTool } from "../tools/types.ts";
import { callTool, pendingInput, say, scriptedLlm, startCore } from "./testkit.ts";

const at = Date.parse("2026-10-05T10:00:00Z");
const date = (minutes: number) => new Date(at + minutes * 60_000).toISOString();
const followup = {
  action: "create",
  purpose: "Read the report",
  condition: { kind: "time", at: date(10) },
  expires_at: date(30),
};

test("owner elevation preserves the actual receiving agent even if the chat's first agent changes mid-turn", async () => {
  let enter: (() => void) | undefined;
  let release: (() => void) | undefined;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const llm = scriptedLlm(async (_req, { said, afterTool }) => {
    if (!afterTool && said === "Return in ten minutes") {
      enter?.();
      await gate;
      return callTool("save", "chat_followup", followup);
    }
    return say("Saved.");
  });
  const env = await startCore({ llm, clock: () => new Date(at) });
  try {
    await env.client.call("agents.update", { agent: "scout", autonomy: "total" });
    const chat = await env.client.call("threads.create", { kind: "loose", agent_id: "scout" });
    const sent = await env.client.call("threads.send", { thread: chat.id, text: "Return in ten minutes" });
    assert.equal(sent.run.agent_id, "scout");
    await entered;
    env.core.store.threads.write(chat.id, { agent_ids: JSON.stringify(["superagent", "scout"]) });
    release?.();
    await env.settle(chat.id);
    const [item] = (await env.client.call("continuations.list", { thread: chat.id })).continuations;
    assert.equal(item?.agent_id, "scout", "callAsOwner must not fall back to the first participant");
    assert.equal(item?.thread_id, chat.id);
    assert.equal(env.core.store.threads.get(chat.id)?.agent_ids[0], "superagent");
  } finally {
    release?.();
    await env.core.close();
    await env.cleanup();
  }
});

test("the elevated scheduling path cannot let a continuation rearm itself, including in Total", async () => {
  let now = new Date(at);
  const llm = scriptedLlm((req, { afterTool }) =>
    afterTool
      ? say(String(req.messages.at(-1)?.content))
      : callTool("again", "chat_followup", {
          ...followup,
          condition: { kind: "time", at: date(20) },
        }),
  );
  const env = await startCore({ llm, clock: () => now });
  try {
    await env.client.call("agents.update", { agent: "superagent", autonomy: "total" });
    await env.client.call("continuations.create", {
      thread: "home",
      purpose: "Read the report",
      condition: { kind: "time", at: date(10) },
      expires_at: date(30),
    });
    now = new Date(at + 10 * 60_000);
    env.core.scheduler.tick();
    await env.settle("home");
    const items = (await env.client.call("continuations.list", { thread: "home" })).continuations;
    assert.equal(items.length, 1, "no elevated recursive request was persisted");
    const messages = (await env.client.call("threads.get", { thread: "home" })).messages;
    const tool = messages.flatMap((m) => m.parts).find((p) => p.type === "tool" && p.tool === "chat_followup");
    assert.ok(tool?.type === "tool" && tool.status === "error");
    assert.match(String(llm.calls.at(-1)?.messages.at(-1)?.content), /only when they ask you themselves/);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a continuation's event is not an effect approval; denying the normal card prevents dispatch", async () => {
  let now = new Date(at);
  let sent = 0;
  const outside = defineTool({
    name: "send_check_result",
    description: "Send the check to someone",
    args: z.object({}),
    effect: "external",
    confirm: "always",
    deadlineMs: 5000,
    title: () => "Send check result",
    run: async () => {
      sent++;
      return "sent";
    },
  });
  const llm = scriptedLlm((_req, { afterTool }) =>
    afterTool ? say("The send was not approved. I did not send anything.") : callTool("send", "send_check_result", {}),
  );
  const env = await startCore({ llm, extraTools: [outside], clock: () => now });
  try {
    await env.client.call("agents.update", { agent: "superagent", autonomy: "auto" });
    await env.client.call("continuations.create", {
      thread: "home",
      purpose: "Check the report",
      condition: { kind: "time", at: date(10) },
      expires_at: date(30),
    });
    now = new Date(at + 10 * 60_000);
    env.core.scheduler.tick();
    const input = await pendingInput(env.client, "home");
    assert.equal(input.kind, "confirm");
    assert.equal(sent, 0, "the timer does not bypass the effect card");
    await env.client.call("runs.respond", { input: input.id, decision: "deny" });
    await env.settle("home");
    assert.equal(sent, 0);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("outside agent clients cannot create follow-ups through an owner-only method", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")), clock: () => new Date(at) });
  try {
    const agent = new ApxClient({ url: env.core.url, actor: "agent" });
    await assert.rejects(
      agent.call("continuations.create", {
        thread: "home",
        purpose: "Read the report",
        condition: { kind: "time", at: date(10) },
        expires_at: date(30),
      }),
    );
    await waitFor(() => env.core.store.continuations.list().length === 0, "no persisted request");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});
