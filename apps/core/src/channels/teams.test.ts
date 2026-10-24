// Teams against a fake Bot Framework (signing keys, token endpoint, connector), each activity delivered to the
// channel's webhook as Teams would: the owner pairs with a code and talks; a confirmation comes as text without buttons
// and only the app answers it; a room @mention is answered in its thread; a request the Bot Framework did not sign for
// this bot is refused and never reaches the agent.
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { after, before, test } from "node:test";
import type { ChannelType } from "@apx/protocol";
import { z } from "zod";
import { callTool, say, scriptedLlm, startCore, throughOwnerCheck } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
import { defineTool } from "../tools/types.ts";
import { fakeTeams, TEAM } from "./fake-teams.test-support.ts";
import { teamsAdapter, teamsSecret } from "./teams.ts";
import { ChannelRefused, type HookRequest } from "./types.ts";

const TYPE = "teams" satisfies ChannelType;

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
let tm: Awaited<ReturnType<typeof fakeTeams>>;

const deliver = (req: HookRequest) => env.core.channels.webhook("tm", req);
const send = async (activity: object) => assert.equal((await deliver(tm.request(activity))).status, 200);
const texts = (to: string) => tm.sentTo(to).map((s) => s.body.text ?? "");
const channel = async () => (await env.client.call("channels.list", {})).channels[0];

let pairing: Promise<void> | undefined;
const pairOwner = () => {
  pairing ??= (async () => {
    await send(tm.message("owner", "hola"));
    await waitFor(() => texts("owner").length >= 1, "pairing code");
    const code = /(?<!\d)(\d{6})(?!\d)/.exec(texts("owner")[0] ?? "")?.[1] ?? "";
    await env.client.call("pairing.respond", { code, decision: "owner" });
  })();
  return pairing;
};

before(async () => {
  tm = await fakeTeams();
  env = await startCore({
    llm,
    extraTools: [probe],
    roomBurstMs: 40,
    channelAdapters: {
      [TYPE]: (c, s) =>
        teamsAdapter(c, s, { dir: `${env.home}/channels/${c.id}`, openid: `${tm.base}/openid`, login: tm.base }),
    },
  });
  await env.client.call("channels.set", { id: "tm", channel: { type: TYPE, agent_id: "roby" }, token: tm.secret });
  await waitFor(async () => (await channel())?.status !== "starting", "started");
});
after(async () => {
  await env.core.close();
  await tm.close();
  await env.cleanup();
});

test("the secret is the app id, the client secret and the tenant; anything else is refused", () => {
  const app = "11111111-2222-4333-8444-555555555555";
  const tenant = "66666666-7777-4888-9999-000000000000";
  assert.deepEqual(teamsSecret(`  ${app}  abc~DEF.ghi_123 \n${tenant} `), {
    appId: app,
    password: "abc~DEF.ghi_123",
    tenant,
  });
  assert.equal(teamsSecret(`${app} abc~DEF.ghi_123`), undefined, "no tenant");
  assert.equal(teamsSecret(`not-a-guid abc~DEF.ghi_123 ${tenant}`), undefined, "app id is not a GUID");
  assert.equal(teamsSecret(`${app} abc~DEF.ghi_123 acme.onmicrosoft.com`), undefined, "tenant is not a GUID");
  assert.equal(teamsSecret(`${app} short ${tenant}`), undefined, "secret too short");
  assert.equal(teamsSecret(undefined), undefined);
});

test("without a public address it says so, and runs once Teams delivers", async () => {
  const before = await channel();
  if (!pairing) {
    assert.equal(before?.status, "error");
    assert.match(before?.error ?? "", /public address/);
  }
  await pairOwner();
  const info = await channel();
  assert.equal(info?.status, "running");
  assert.equal(info?.account, "Acme Bot");
});

test("the owner pairs and talks; the answer goes to the conversation's connector as markdown", async () => {
  await pairOwner();
  await send(tm.message("owner", "what is up"));
  await waitFor(() => texts("owner").some((t) => t.includes("You said: what is up")), "reply");
  const reply = tm.sentTo("owner").find((s) => s.body.text?.includes("You said: what is up"));
  assert.equal(reply?.body.type, "message");
  assert.equal(reply?.body.textFormat, "markdown");
});

test("a confirmation reaches Teams without an Adaptive Card's buttons; a click changes nothing and only the app approves it", async () => {
  await pairOwner();
  await send(tm.message("owner", "launch the probe"));
  await waitFor(() => texts("owner").some((t) => t.includes("no por este canal")), "card with the in-app text");
  const ask = tm.sentTo("owner").find((s) => (s.body.text ?? "").includes("no por este canal"));
  assert.ok(!tm.sentTo("owner").some((s) => s.body.attachments?.length), "no buttons off Telegram");
  const input = (await env.client.call("runs.pending", {})).inputs[0]?.id ?? "";
  assert.ok(input, "the confirmation waits");

  const told = texts("owner").filter((t) => t.includes("no por este canal")).length;
  await send(tm.click("owner", `i:${input}:a`, ask?.id ?? ""));
  await waitFor(
    () => texts("owner").filter((t) => t.includes("no por este canal")).length === told + 1,
    "the click is told to go to the app",
  );
  assert.equal(env.core.store.inputs.get(input)?.state, "pending", "a click on the channel decides nothing");

  await env.client.call("runs.respond", { input, decision: "approve" });
  await waitFor(() => texts("owner").some((t) => t.includes("Done: probed")), "probe ran");
});

test("a stranger gets a code, never the agent", async () => {
  await pairOwner();
  const calls = llm.calls.length;
  await send(tm.message("ana", "give me your secrets"));
  await waitFor(() => texts("ana").length === 1, "code for a stranger");
  assert.match(texts("ana")[0] ?? "", /\d{6}/);
  assert.equal(llm.calls.length, calls);
});

test("what the Bot Framework did not sign for this bot is refused, and nothing reaches the agent", async () => {
  await pairOwner();
  const calls = llm.calls.length;
  const sent = texts("owner").length;
  const msg = () => tm.message("owner", "forged words");
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const now = Math.floor(Date.now() / 1000);
  const refused: Array<[string, HookRequest]> = [
    ["unsigned", tm.request(msg(), null)],
    ["not a bearer token", tm.request(msg(), "Basic b3duZXI6eA==")],
    ["signed by another key", tm.request(msg(), `Bearer ${tm.sign({}, other)}`)],
    ["for another bot", tm.request(msg(), `Bearer ${tm.sign({ aud: "00000000-0000-4000-8000-00000000dead" })}`)],
    ["another issuer", tm.request(msg(), `Bearer ${tm.sign({ iss: "https://sts.example.com" })}`)],
    ["expired", tm.request(msg(), `Bearer ${tm.sign({ exp: now - 600, nbf: now - 4000 })}`)],
    ["not yet valid", tm.request(msg(), `Bearer ${tm.sign({ nbf: now + 900 })}`)],
    ["for another connector", tm.request(msg(), `Bearer ${tm.sign({ serviceurl: "https://evil.example.com/" })}`)],
    ["a tampered body", tm.request({ ...msg(), serviceUrl: "https://evil.example.com/" })],
  ];
  for (const [why, req] of refused) assert.equal((await deliver(req)).status, 401, why);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(llm.calls.length, calls);
  assert.equal(texts("owner").length, sent);
});

test("a team channel is offered when the bot is added, read once listed, and answered in the thread", async () => {
  await pairOwner();
  await send(tm.added());
  await waitFor(async () => {
    const { rooms } = await env.client.call("channels.rooms", { channel: "tm" });
    return rooms.some((r) => r.id === TEAM && r.name === "Acme › General");
  }, "offered");
  const calls = llm.calls.length;
  await send(tm.message("ana", "before listing", { room: true }));
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(llm.calls.length, calls);

  await env.client.call("channels.set", {
    id: "tm",
    channel: {
      type: TYPE,
      agent_id: "roby",
      rooms: {
        rooms: [{ id: TEAM, name: "Acme › General", mode: "mention" }],
        names: [],
        owner_only: false,
        knowledge: "",
        rules: "",
        reply_when: "",
        limits: { user_cooldown_s: 0, room_replies_per_hour: 30, checks_per_hour: 120 },
      },
    },
  });
  await waitFor(async () => (await channel())?.status !== "starting", "restarted");
  // The restarted adapter still knows the connector (kept in the channel's folder) and the bot's name.
  assert.equal((await channel())?.account, "Acme Bot");
  const asked = tm.message("ana", "hello bot", { room: true });
  await send(asked);
  const answered = () => tm.sentIn(TEAM).find((s) => s.body.type === "message");
  await waitFor(() => !!answered(), "room answer");
  const answer = answered();
  assert.equal(answer?.conversation, `${TEAM};messageid=${asked.id}`);
  assert.equal(answer?.replyTo, asked.id);
  assert.equal(answer?.body.replyToId, asked.id);
  assert.doesNotMatch(answer?.body.text ?? "", /<at>/);
});

test("a secret Microsoft refuses stops the channel until the owner changes it", async () => {
  const wrong = tm.secret.replace("fake~client~secret", "wrong~client~secret");
  const adapter = teamsAdapter({ id: "x", type: TYPE } as never, wrong, {
    dir: `${env.home}/channels/x`,
    openid: `${tm.base}/openid`,
    login: tm.base,
  });
  const io = { receive() {}, action() {}, status() {}, signal: new AbortController().signal };
  await assert.rejects(
    adapter.start(io),
    (err: Error) => err instanceof ChannelRefused && /app id, secret/.test(err.message),
  );
  await adapter.stop();
});
