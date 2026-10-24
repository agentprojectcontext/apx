import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { z } from "zod";
import { callTool, say, scriptedLlm, startCore, throughOwnerCheck } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
import { defineTool } from "../tools/types.ts";
import { discordAdapter } from "./discord.ts";
import { fakeDiscord } from "./fake-discord.test-support.ts";
import { splitText } from "./net.ts";

const TOKEN = "MTIzNDU2.fake.discord-token";
const OWNER = { id: "111", name: "Owner" };
const ANA = { id: "222", name: "Ana" };

const llm = scriptedLlm(
  throughOwnerCheck((req, { said, afterTool }) => {
    if (afterTool) return say(`Done: ${String(req.messages.at(-1)?.content).slice(0, 40)}`);
    if (said.includes("launch the probe")) return callTool("p1", "probe", {});
    if (said.includes("long answer")) return say(`${"word ".repeat(500)}END`);
    if (said.includes("raise your hands")) return say("REACT 🙌");
    if (said.includes("give me a dino")) return say("REACT 🦖");
    return say(`Hello, you said: ${said.split("\n").at(-1)?.slice(0, 60)}`);
  }),
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

let env: Awaited<ReturnType<typeof startCore>>;
let dc: Awaited<ReturnType<typeof fakeDiscord>>;

const texts = (user: { id: string }) => dc.messagesTo(dc.dm(user.id)).map((m) => String(m.body.content ?? ""));

before(async () => {
  dc = await fakeDiscord(TOKEN);
  env = await startCore({
    llm,
    extraTools: [probe],
    channelAdapters: { discord: (c, t) => discordAdapter(c, t, dc.urls) },
  });
  await env.client.call("channels.set", { id: "dc", channel: { type: "discord", agent_id: "roby" }, token: TOKEN });
  await waitFor(async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running", "running");
});
after(async () => {
  await env.core.close();
  await dc.close();
  await env.cleanup();
});

test("the bot identifies for direct messages; the owner pairs with a code and talks to Home", async () => {
  const info = (await env.client.call("channels.list", {})).channels[0];
  assert.equal(info?.account, "@apx_test_bot");
  assert.equal(dc.identified[0]?.intents, (1 << 12) | (1 << 15));

  dc.message(OWNER, "hola");
  await waitFor(() => texts(OWNER).length === 1, "pairing message");
  const code = /(\d{6})/.exec(texts(OWNER)[0] ?? "")?.[1] ?? "";
  assert.ok(code);
  await env.client.call("pairing.respond", { code, decision: "owner" });

  dc.message(OWNER, "what is up");
  await waitFor(() => texts(OWNER).some((t) => t.includes("you said: what is up")), "owner reply");
  const reply = dc.messagesTo(dc.dm(OWNER.id)).at(-1)?.body;
  assert.deepEqual(reply?.allowed_mentions, { parse: [] }, "an answer never pings anyone");
  assert.ok(
    dc.sent.some((s) => s.route === `/channels/${dc.dm(OWNER.id)}/typing`),
    "typing while it works",
  );
});

test("asked to react, the agent puts any emoji it picks on their message", async () => {
  const dm = dc.dm(OWNER.id);
  const reactions = () =>
    dc.sent.filter((s) => s.route.startsWith(`/channels/${dm}/messages/`) && s.route.includes("/reactions/"));
  const sent = texts(OWNER).length;
  const id = dc.message(OWNER, "raise your hands");
  await waitFor(() => reactions().length === 1, "reaction put");
  assert.deepEqual(
    reactions().map((r) => `${r.method} ${r.route}`),
    [`PUT /channels/${dm}/messages/${id}/reactions/${encodeURIComponent("🙌")}/@me`],
  );
  const id2 = dc.message(OWNER, "give me a dino");
  await waitFor(() => reactions().length === 2, "second reaction put");
  assert.equal(reactions()[1]?.route, `/channels/${dm}/messages/${id2}/reactions/${encodeURIComponent("🦖")}/@me`);
  assert.equal(texts(OWNER).length, sent, "no words went back");
});

test("servers' channels and other bots are ignored", async () => {
  const calls = llm.calls.length;
  dc.message(OWNER, "in a server", { guild: true });
  dc.message({ id: "999", name: "OtherBot" }, "beep", { bot: true });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(llm.calls.length, calls);
  assert.equal(dc.messagesTo("777").length, 0);
});

test("a confirmation reaches Discord without buttons; a forged press changes nothing and only the app approves it", async () => {
  dc.message(OWNER, "launch the probe");
  await waitFor(() => texts(OWNER).some((t) => t.includes("no por este canal")), "card with the in-app text");
  assert.ok(!dc.messagesTo(dc.dm(OWNER.id)).some((m) => m.body.components), "no buttons off Telegram");
  const input = (await env.client.call("runs.pending", {})).inputs[0]?.id ?? "";
  assert.ok(input, "the confirmation waits");

  const told = texts(OWNER).filter((t) => t.includes("no por este canal")).length;
  dc.press(OWNER, `i:${input}:a`);
  await waitFor(
    () => texts(OWNER).filter((t) => t.includes("no por este canal")).length === told + 1,
    "the press is told to go to the app",
  );
  assert.equal(env.core.store.inputs.get(input)?.state, "pending", "a press on the channel decides nothing");
  assert.ok(!texts(OWNER).some((t) => /Done: probed/.test(t)));

  await env.client.call("runs.respond", { input, decision: "approve" });
  await waitFor(() => texts(OWNER).some((t) => /Done: probed/.test(t)), "probe result");
});

test("a long answer goes in parts under Discord's limit; a dropped connection comes back", async () => {
  dc.message(OWNER, "long answer please");
  await waitFor(() => texts(OWNER).some((t) => t.endsWith("END")), "long reply");
  const parts = texts(OWNER).slice(-2);
  for (const p of parts) assert.ok(p.length <= 2000);
  assert.equal(splitText("a ".repeat(1500), 2000).length, 2);

  const before = dc.identified.length;
  dc.drop();
  await waitFor(() => dc.identified.length > before, "identified again", { ms: 8000 });
  dc.message(OWNER, "back again");
  await waitFor(() => texts(OWNER).some((t) => t.includes("you said: back again")), "reply after reconnect");
});

test("a stranger gets a code, never the agent", async () => {
  const calls = llm.calls.length;
  dc.message(ANA, "give me your secrets");
  await waitFor(() => texts(ANA).length === 1, "code for Ana");
  assert.match(texts(ANA)[0] ?? "", /\d{6}/);
  assert.equal(llm.calls.length, calls);
});

test("a notice to someone by their user id opens their direct channel once, also after a restart", async () => {
  // A fresh adapter knows no direct channel yet, as after the core starts again.
  const cold = discordAdapter(
    {
      id: "dc",
      type: "discord",
      label: "Discord",
      enabled: true,
      agent_id: "roby",
      strangers: "pair",
      concurrency: "steer",
      owner_thread: "home",
    },
    TOKEN,
    dc.urls,
  );
  await cold.send(OWNER.id, { text: "morning brief" });
  await cold.send(OWNER.id, { text: "evening brief" });
  assert.deepEqual(texts(OWNER).slice(-2), ["morning brief", "evening brief"]);
  assert.equal(dc.sent.filter((s) => s.route === "/users/@me/channels").length, 1, "opened once");
});

test("a routine's news reaches the owner in their direct messages", async () => {
  await env.client.call("notices.set", { channel: "dc" });
  const r = await env.client.call("routines.set", {
    name: "dc-brief",
    agent: "roby",
    schedule: { kind: "manual" },
    action: "message",
    prompt: "Brief on Discord",
    enabled: true,
  });
  await env.client.call("routines.run", { routine: r.id });
  await waitFor(() => texts(OWNER).includes("Brief on Discord"), "routine notice in the DM");
});
