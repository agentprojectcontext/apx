import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { z } from "zod";
import { callTool, say, scriptedLlm, startCore, throughOwnerCheck } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
import { defineTool } from "../tools/types.ts";
import { fakeSlack } from "./fake-slack.test-support.ts";
import { slackAdapter, slackTokens, toSlackMrkdwn } from "./slack.ts";

const TOKENS = { bot: "xoxb-1-fake-bot", app: "xapp-1-fake-app" };
const OWNER = { id: "U111" };
const ANA = { id: "U222" };

const llm = scriptedLlm(
  throughOwnerCheck((req, { said, afterTool }) => {
    if (afterTool) return say(`Done: ${String(req.messages.at(-1)?.content).slice(0, 40)}`);
    if (said.includes("launch the probe")) return callTool("p1", "probe", {});
    return say(`Hello **there**, you said: ${said.split("\n").at(-1)?.slice(0, 60)}`);
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
let sl: Awaited<ReturnType<typeof fakeSlack>>;

const texts = (user: { id: string }) => sl.messagesTo(sl.dm(user.id)).map((m) => String(m.body.text ?? ""));

/**
 * Pairs the owner once (their first message gets a code, which the owner approves); every test that writes as the
 * owner starts here, so one that fails does not take the others down with it. Returns the first message's envelope.
 */
let pairing: Promise<string> | undefined;
const pairOwner = () => {
  pairing ??= (async () => {
    const envelope = sl.message(OWNER, "hola");
    await waitFor(() => texts(OWNER).length >= 1, "pairing message");
    const code = /(\d{6})/.exec(texts(OWNER)[0] ?? "")?.[1] ?? "";
    await env.client.call("pairing.respond", { code, decision: "owner" });
    return envelope;
  })();
  return pairing;
};

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
  await waitFor(async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running", "running");
});
after(async () => {
  await env.core.close();
  await sl.close();
  await env.cleanup();
});

test("tokens and formatting: both tokens from one secret; Markdown becomes mrkdwn", () => {
  assert.deepEqual(slackTokens("xapp-a xoxb-b"), { bot: "xoxb-b", app: "xapp-a" });
  assert.deepEqual(slackTokens("xoxb-b"), { bot: "xoxb-b", app: undefined });
  assert.equal(toSlackMrkdwn("**hi** <b> [docs](https://example.com)"), "*hi* &lt;b&gt; <https://example.com|docs>");
});

test("the app runs as its bot; the owner pairs with a code and their words reach Home, acknowledged", async () => {
  // Written as soon as the channel says it runs: "running" means its socket is there to receive it.
  const env1 = await pairOwner();
  const info = (await env.client.call("channels.list", {})).channels[0];
  assert.equal(info?.account, "@apx · Northwind");
  assert.equal(texts(OWNER).length, 1, "one pairing message");
  assert.ok(sl.acked.includes(env1), "the envelope is acknowledged once stored");

  sl.message(OWNER, "what is up");
  await waitFor(() => texts(OWNER).some((t) => t.includes("you said: what is up")), "owner reply");
  assert.match(texts(OWNER).at(-1) ?? "", /\*there\*/);
  const home = await env.client.call("threads.get", { thread: "home" });
  assert.ok(home.messages.some((m) => m.parts.some((p) => p.type === "text" && p.text === "what is up")));
});

test("channels, edits and the app's own messages are ignored", async () => {
  await pairOwner();
  const calls = llm.calls.length;
  sl.message(OWNER, "in a channel", { channel: true });
  sl.message(OWNER, "edited", { subtype: "message_changed" });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(llm.calls.length, calls);
});

test("a confirmation reaches Slack without buttons; a press changes nothing and only the app approves it", async () => {
  await pairOwner();
  sl.message(OWNER, "launch the probe");
  await waitFor(() => texts(OWNER).some((t) => t.includes("no por este canal")), "card with the in-app text");
  assert.ok(!sl.messagesTo(sl.dm(OWNER.id)).some((m) => m.body.blocks), "no buttons off Telegram");
  const input = (await env.client.call("runs.pending", {})).inputs[0]?.id ?? "";
  assert.ok(input, "the confirmation waits");

  const told = texts(OWNER).filter((t) => t.includes("no por este canal")).length;
  sl.press(OWNER, `i:${input}:a`);
  await waitFor(
    () => texts(OWNER).filter((t) => t.includes("no por este canal")).length === told + 1,
    "the press is told to go to the app",
  );
  assert.equal(env.core.store.inputs.get(input)?.state, "pending", "a press on the channel decides nothing");

  await env.client.call("runs.respond", { input, decision: "approve" });
  await waitFor(() => texts(OWNER).some((t) => /Done: probed/.test(t)), "probe result");
});

test("Slack asking to reconnect opens a new socket; a rate-limited send is retried", async () => {
  await pairOwner();
  const opens = sl.opens();
  sl.disconnect();
  await waitFor(() => sl.opens() > opens && sl.connections() === 1, "reconnected", { ms: 8000 });
  sl.failures.set("chat.postMessage", [
    { status: 429, body: { ok: false, error: "ratelimited" }, headers: { "retry-after": "0" } },
  ]);
  sl.message(OWNER, "after the reconnect");
  await waitFor(() => texts(OWNER).some((t) => t.includes("you said: after the reconnect")), "reply", { ms: 8000 });
});

test("a stranger gets a code, never the agent", async () => {
  const calls = llm.calls.length;
  sl.message(ANA, "give me your secrets");
  await waitFor(() => texts(ANA).length === 1, "code for Ana");
  assert.match(texts(ANA)[0] ?? "", /\d{6}/);
  assert.equal(llm.calls.length, calls);
});
