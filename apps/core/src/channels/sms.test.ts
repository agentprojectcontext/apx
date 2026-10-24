// SMS through Twilio against its fake: the channel starts from now (history is never answered), the owner pairs with
// a code, their words reach the agent and the answer comes back; a confirmation comes without options and only the
// app answers it; a restart replays nothing; a number that answered STOP is a final failure.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import type { ChannelType } from "@apx/protocol";
import { z } from "zod";
import { callTool, say, scriptedLlm, startCore, throughOwnerCheck } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
import { defineTool } from "../tools/types.ts";
import { fakeTwilio } from "./fake-twilio.test-support.ts";
import { smsAdapter, smsSecret } from "./sms.ts";
import { SendError } from "./types.ts";

const TYPE = "sms" satisfies ChannelType;
const OWNER = "+15550002222";
const ANA = "+15550003333";

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

const llm = scriptedLlm(
  throughOwnerCheck((req, { said, afterTool }) => {
    if (afterTool) return say(`Done: ${String(req.messages.at(-1)?.content).slice(0, 40)}`);
    if (said.includes("launch the probe")) return callTool("p1", "probe", {});
    return say(`You said: ${said.split("\n").at(-1)?.slice(0, 60)}`);
  }),
);

let env: Awaited<ReturnType<typeof startCore>>;
let tw: Awaited<ReturnType<typeof fakeTwilio>>;
let old: string;

const running = () =>
  waitFor(async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running", "running");

let pairing: Promise<void> | undefined;
const pairOwner = () => {
  pairing ??= (async () => {
    tw.message(OWNER, "hola");
    await waitFor(() => tw.sentTo(OWNER).length >= 1, "pairing code");
    const code = /(?<!\d)(\d{6})(?!\d)/.exec(tw.sentTo(OWNER)[0] ?? "")?.[1] ?? "";
    await env.client.call("pairing.respond", { code, decision: "owner" });
  })();
  return pairing;
};

before(async () => {
  tw = await fakeTwilio();
  // Sent before the channel existed: history, never answered.
  old = tw.message(OWNER, "an old message", new Date(Date.now() - 60_000));
  env = await startCore({
    llm,
    extraTools: [probe],
    channelAdapters: {
      [TYPE]: (c, s) => smsAdapter(c, s, { dir: path.join(env.home, "channels", c.id), api: tw.api, pollMs: 50 }),
    },
  });
  await env.client.call("channels.set", { id: "sms", channel: { type: TYPE, agent_id: "roby" }, token: tw.secret });
  await running();
});
after(async () => {
  await env.core.close();
  await tw.close();
  await env.cleanup();
});

test("the secret is the account SID, its auth token and an E.164 number", () => {
  const sid = `AC${"a1".repeat(16)}`;
  const token = "b2".repeat(16);
  assert.deepEqual(smsSecret(`${sid} ${token} +15550001111`), { sid, token, from: "+15550001111" });
  assert.deepEqual(smsSecret(`+15550001111 ${token} ${sid}`), { sid, token, from: "+15550001111" });
  assert.equal(smsSecret(`${sid} ${token} 15550001111`), undefined, "no + on the number");
  assert.equal(smsSecret(`AC123 ${token} +15550001111`), undefined, "a short SID");
  assert.equal(smsSecret(`${sid} +15550001111`), undefined, "no token");
  assert.equal(smsSecret(undefined), undefined);
});

test("the channel starts from now: an old message is not answered; the owner pairs and talks", async () => {
  assert.equal((await env.client.call("channels.list", {})).channels[0]?.account, "+15550001111");
  await pairOwner();
  assert.ok(!tw.sentTo(OWNER).some((t) => t.includes("an old message")));
  tw.message(OWNER, "what is up");
  await waitFor(() => tw.sentTo(OWNER).some((t) => t.includes("You said: what is up")), "reply");
  const home = await env.client.call("threads.get", { thread: "home" });
  assert.ok(!home.messages.some((m) => m.parts.some((p) => p.type === "text" && p.text === "an old message")));
  assert.ok(old);
  const q = tw.queries.at(-1);
  assert.equal(q?.get("To"), "+15550001111");
  assert.match(q?.get("DateSent>") ?? "", /^\d{4}-\d{2}-\d{2}$/);
});

test("a confirmation reaches SMS without options, a typed number does not answer it and only the app does", async () => {
  await pairOwner();
  tw.message(OWNER, "launch the probe");
  await waitFor(() => tw.sentTo(OWNER).some((t) => t.includes("no por este canal")), "card without options");
  assert.ok(!tw.sentTo(OWNER).some((t) => /\n1\. /.test(t)), "no numbered options off Telegram");
  const input = (await env.client.call("runs.pending", {})).inputs[0]?.id ?? "";
  assert.ok(input, "the confirmation waits");

  tw.message(OWNER, "1");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(env.core.store.inputs.get(input)?.state, "pending", "a typed number answers nothing");

  await env.client.call("runs.respond", { input, decision: "approve" });
  await waitFor(() => tw.sentTo(OWNER).some((t) => t.includes("Done: probed")), "probe ran");
  await waitFor(() => tw.sentTo(OWNER).some((t) => t.includes("You said: 1")), "the number was relayed as words");
});

test("a stranger gets a code, never the agent", async () => {
  await pairOwner();
  const calls = llm.calls.length;
  tw.message(ANA, "give me your secrets");
  await waitFor(() => tw.sentTo(ANA).length === 1, "code for a stranger");
  assert.match(tw.sentTo(ANA)[0] ?? "", /\d{6}/);
  assert.equal(llm.calls.length, calls);
});

test("a restart replays nothing, and what came while it was off is read once", async () => {
  await pairOwner();
  const calls = llm.calls.length;
  assert.ok(fs.existsSync(path.join(env.home, "channels", "sms", "sms-state.json")));
  await env.client.call("channels.set", { id: "sms", channel: { type: TYPE, agent_id: "roby", enabled: false } });
  await waitFor(async () => (await env.client.call("channels.list", {})).channels[0]?.status !== "running", "stopped");
  tw.message(OWNER, "while away");
  await env.client.call("channels.set", { id: "sms", channel: { type: TYPE, agent_id: "roby", enabled: true } });
  await running();
  await waitFor(() => tw.sentTo(OWNER).some((t) => t.includes("You said: while away")), "missed message read");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(llm.calls.length, calls + 2, "only the missed message (the check, then the answer), nothing replayed");
});

test("long text goes in parts of at most 1600 characters; a number that answered STOP is a final failure", async () => {
  const a = smsAdapter({ id: "x", type: TYPE, agent_id: "roby" } as Parameters<typeof smsAdapter>[0], tw.secret, {
    dir: path.join(env.home, "scratch-sms"),
    api: tw.api,
  });
  const to = "+15550004444";
  await a.send(to, { text: "word ".repeat(500) });
  assert.equal(tw.sentTo(to).length, 2);
  assert.ok(tw.sentTo(to).every((t) => t.length <= 1600));
  tw.stopped.add(to);
  await assert.rejects(a.send(to, { text: "hi" }), (err: unknown) => err instanceof SendError && err.kind === "fatal");
});
