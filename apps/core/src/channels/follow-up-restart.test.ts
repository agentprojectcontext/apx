import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { removeDir, tempDir, waitFor } from "../testkit/platform.ts";
import { defineTool } from "../tools/types.ts";
import { fakeTelegram } from "./fake-telegram.test-support.ts";
import { telegramAdapter } from "./telegram.ts";

const TOKEN = "123456:TEST-token";
const OWNER = { id: 1001, name: "Owner" };
const llm = scriptedLlm((_req, { said, afterTool }) =>
  afterTool ? say("Done") : said.includes("launch the probe") ? callTool("p1", "probe", {}) : say("ok"),
);
const probe = defineTool({
  name: "probe",
  description: "test tool that always asks the owner",
  args: z.object({}),
  effect: "external",
  confirm: "always",
  deadlineMs: 60_000,
  title: () => "Probe",
  run: async () => "probed",
});

test("a question still waiting in the app after a restart follows the owner to Telegram once, when its time comes", async () => {
  const home = tempDir("apx-follow-up-").path;
  const tg = await fakeTelegram(TOKEN);
  const boot = () =>
    startCore({
      home,
      llm,
      extraTools: [probe],
      channelAdapters: { telegram: (c, t) => telegramAdapter(c, t, tg.url) },
    });
  let env = await boot();
  try {
    await env.client.call("channels.set", { id: "tg", channel: { type: "telegram", agent_id: "roby" }, token: TOKEN });
    await waitFor(
      async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running",
      "running",
    );
    tg.message(OWNER, "hola");
    await waitFor(() => tg.messagesTo(OWNER.id).length === 1, "pairing code");
    const code = /(\d{6})/.exec(String(tg.messagesTo(OWNER.id)[0]?.body.text))?.[1] ?? "";
    await env.client.call("pairing.respond", { code, decision: "owner" });
    await waitFor(() => Boolean(env.core.store.persons.ownerAddress("tg")), "the owner paired on Telegram");

    // Asked in the app, with two minutes to answer there before it follows the owner.
    await env.client.call("notices.set", { inputs_after_s: 120 });
    const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
    await env.client.call("threads.send", { thread: t.id, text: "launch the probe" });
    await waitFor(async () => (await env.client.call("runs.pending", { thread: t.id })).inputs.length > 0, "the card");
    await env.client.call("notices.set", { inputs_after_s: 1 });
    const before = tg.messagesTo(OWNER.id).length;

    // The core restarts: the wait it had in mind is gone, the question is not.
    await env.core.close();
    env = await boot();
    await waitFor(() => tg.messagesTo(OWNER.id).length > before, "the follow-up after the restart");
    assert.ok(tg.messagesTo(OWNER.id).at(-1)?.body.reply_markup, "with its buttons");

    // Started again, it knows the question already went out: never twice.
    await env.core.close();
    env = await boot();
    await waitFor(async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running", "again");
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(tg.messagesTo(OWNER.id).length, before + 1);
  } finally {
    await env.core.close();
    await tg.close();
    await removeDir(home);
  }
});
