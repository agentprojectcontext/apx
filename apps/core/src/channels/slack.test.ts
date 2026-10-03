import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { z } from "zod";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { defineTool } from "../tools/types.ts";
import { fakeSlack } from "./fake-slack.test-support.ts";
import { slackAdapter, slackTokens, toSlackMrkdwn } from "./slack.ts";

const TOKENS = { bot: "xoxb-1-fake-bot", app: "xapp-1-fake-app" };
const OWNER = { id: "U111" };
const ANA = { id: "U222" };

const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(`Done: ${String(req.messages.at(-1)?.content).slice(0, 40)}`);
  if (said.includes("launch the probe")) return callTool("p1", "probe", {});
  return say(`Hello **there**, you said: ${said.split("\n").at(-1)?.slice(0, 60)}`);
});

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
let sl: Awaited<ReturnType<typeof fakeSlack>>;

const until = async (check: () => boolean | Promise<boolean>, what: string, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`never: ${what}`);
};
const texts = (user: { id: string }) => sl.messagesTo(sl.dm(user.id)).map((m) => String(m.body.text ?? ""));

before(async () => {
  sl = await fakeSlack(TOKENS);
  env = await startCore({
    llm,
    extraTools: [probe],
    channelAdapters: { slack: (c, t) => slackAdapter(c, t, sl.api) },
  });
  await env.client.call("channels.set", {
    id: "sl",
    channel: { type: "slack", agent_id: "roby" },
    token: `${TOKENS.app} ${TOKENS.bot}`,
  });
  await until(async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running", "running");
});
after(async () => {
  await env.core.close();
  await sl.close();
  env.cleanup();
});

test("tokens and formatting: both tokens from one secret; Markdown becomes mrkdwn", () => {
  assert.deepEqual(slackTokens("xapp-a xoxb-b"), { bot: "xoxb-b", app: "xapp-a" });
  assert.deepEqual(slackTokens("xoxb-b"), { bot: "xoxb-b", app: undefined });
  assert.equal(toSlackMrkdwn("**hi** <b> [docs](https://example.com)"), "*hi* &lt;b&gt; <https://example.com|docs>");
});

test("the app runs as its bot; the owner pairs with a code and their words reach Home, acknowledged", async () => {
  const info = (await env.client.call("channels.list", {})).channels[0];
  assert.equal(info?.account, "@apx · Northwind");
  const env1 = sl.message(OWNER, "hola");
  await until(() => texts(OWNER).length === 1, "pairing message");
  assert.ok(sl.acked.includes(env1), "the envelope is acknowledged once stored");
  const code = /(\d{6})/.exec(texts(OWNER)[0] ?? "")?.[1] ?? "";
  await env.client.call("pairing.respond", { code, decision: "owner" });

  sl.message(OWNER, "what is up");
  await until(() => texts(OWNER).some((t) => t.includes("you said: what is up")), "owner reply");
  assert.match(texts(OWNER).at(-1) ?? "", /\*there\*/);
  const home = await env.client.call("threads.get", { thread: "home" });
  assert.ok(home.messages.some((m) => m.parts.some((p) => p.type === "text" && p.text === "what is up")));
});

test("channels, edits and the app's own messages are ignored", async () => {
  const calls = llm.calls.length;
  sl.message(OWNER, "in a channel", { channel: true });
  sl.message(OWNER, "edited", { subtype: "message_changed" });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(llm.calls.length, calls);
});

test("a confirmation comes with buttons; the owner's press approves it and the buttons go", async () => {
  sl.message(OWNER, "launch the probe");
  await until(() => sl.messagesTo(sl.dm(OWNER.id)).some((m) => m.body.blocks), "buttons");
  const ask = sl.messagesTo(sl.dm(OWNER.id)).find((m) => m.body.blocks);
  const blocks = ask?.body.blocks as Array<{ type: string; elements?: Array<{ value: string }> }>;
  const allow = blocks.find((b) => b.type === "actions")?.elements?.[0]?.value ?? "";
  assert.match(allow, /^i:.+:a$/);
  sl.press(OWNER, allow);
  await until(() => texts(OWNER).some((t) => /Done: probed/.test(t)), "probe result");
  assert.ok(
    sl.sent.some((s) => s.method === "chat.update"),
    "the pressed message loses its buttons",
  );
});

test("Slack asking to reconnect opens a new socket; a rate-limited send is retried", async () => {
  const opens = sl.opens();
  sl.disconnect();
  await until(() => sl.opens() > opens && sl.connections() === 1, "reconnected", 8000);
  sl.failures.set("chat.postMessage", [
    { status: 429, body: { ok: false, error: "ratelimited" }, headers: { "retry-after": "0" } },
  ]);
  sl.message(OWNER, "after the reconnect");
  await until(() => texts(OWNER).some((t) => t.includes("you said: after the reconnect")), "reply", 8000);
});

test("a stranger gets a code, never the agent", async () => {
  const calls = llm.calls.length;
  sl.message(ANA, "give me your secrets");
  await until(() => texts(ANA).length === 1, "code for Ana");
  assert.match(texts(ANA)[0] ?? "", /\d{6}/);
  assert.equal(llm.calls.length, calls);
});
