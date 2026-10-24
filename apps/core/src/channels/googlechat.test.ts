// Google Chat against its fake (token endpoint, Pub/Sub, Chat API): the owner pairs with a code, their words reach the
// agent and the answer comes back; a confirmation comes without buttons and only the app answers it; a stranger gets a
// code; a space is offered to pick and read only once listed, its answer joining the thread.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { ChannelType } from "@apx/protocol";
import { z } from "zod";
import { callTool, say, scriptedLlm, startCore, throughOwnerCheck } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
import { defineTool } from "../tools/types.ts";
import { fakeGoogleChat } from "./fake-googlechat.test-support.ts";
import { googlechatAdapter, googlechatSecret } from "./googlechat.ts";

const TYPE = "googlechat" satisfies ChannelType;

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
let gc: Awaited<ReturnType<typeof fakeGoogleChat>>;

const texts = (to: string) => gc.sentTo(to).map((s) => s.body.text ?? "");
const running = () =>
  waitFor(async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running", "running");

let pairing: Promise<void> | undefined;
const pairOwner = () => {
  pairing ??= (async () => {
    gc.message("owner", "hola");
    await waitFor(() => texts("owner").length >= 1, "pairing code");
    const code = /(?<!\d)(\d{6})(?!\d)/.exec(texts("owner")[0] ?? "")?.[1] ?? "";
    await env.client.call("pairing.respond", { code, decision: "owner" });
  })();
  return pairing;
};

before(async () => {
  gc = await fakeGoogleChat();
  env = await startCore({
    llm,
    extraTools: [probe],
    roomBurstMs: 40,
    channelAdapters: {
      [TYPE]: (c, s) => googlechatAdapter(c, s, { pubsub: gc.base, chat: gc.base, idleMs: 20 }),
    },
  });
  await env.client.call("channels.set", { id: "gc", channel: { type: TYPE, agent_id: "roby" }, token: gc.secret });
  await running();
});
after(async () => {
  await env.core.close();
  await gc.close();
  await env.cleanup();
});

test("the secret is the subscription and the key's JSON, in either order; anything else is refused", () => {
  const key = { client_email: "a@acme.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nx\n" };
  const sub = "projects/acme/subscriptions/chat";
  assert.deepEqual(googlechatSecret(`${sub}\n${JSON.stringify(key, null, 2)}`), { key, subscription: sub });
  assert.deepEqual(googlechatSecret(`${JSON.stringify({ ...key, token_uri: "https://t.example" })} ${sub}`), {
    key: { ...key, token_uri: "https://t.example" },
    subscription: sub,
  });
  assert.equal(googlechatSecret(JSON.stringify(key)), undefined, "no subscription");
  assert.equal(googlechatSecret(`projects/acme/topics/chat ${JSON.stringify(key)}`), undefined, "a topic");
  assert.equal(googlechatSecret(`${sub} {"client_email":"a@acme"}`), undefined, "no private key");
  assert.equal(googlechatSecret(`${sub} {not json}`), undefined);
  assert.equal(googlechatSecret(undefined), undefined);
});

test("the app runs as its service account; the owner pairs and talks, each event acknowledged once stored", async () => {
  const info = (await env.client.call("channels.list", {})).channels[0];
  assert.equal(info?.account, "apx-chat@acme.iam.gserviceaccount.com");
  await pairOwner();
  const ack = gc.message("owner", "what is up");
  await waitFor(() => texts("owner").some((t) => t.includes("You said: what is up")), "reply");
  assert.ok(gc.acked.includes(ack));
});

test("a confirmation reaches Google Chat without card buttons; a click changes nothing and only the app approves it", async () => {
  await pairOwner();
  gc.message("owner", "launch the probe");
  await waitFor(() => texts("owner").some((t) => t.includes("no por este canal")), "card with the in-app text");
  const ask = gc.sentTo("owner").find((s) => (s.body.text ?? "").includes("no por este canal"));
  assert.ok(!gc.sentTo("owner").some((s) => s.body.cardsV2), "no buttons off Telegram");
  const input = (await env.client.call("runs.pending", {})).inputs[0]?.id ?? "";
  assert.ok(input, "the confirmation waits");

  const told = texts("owner").filter((t) => t.includes("no por este canal")).length;
  gc.click("owner", `i:${input}:a`, ask?.name ?? "");
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
  gc.message("ana", "give me your secrets");
  await waitFor(() => texts("ana").length === 1, "code for a stranger");
  assert.match(texts("ana")[0] ?? "", /\d{6}/);
  assert.equal(llm.calls.length, calls);
});

test("a space is offered but not read until listed; then its answer joins the thread", async () => {
  await pairOwner();
  const calls = llm.calls.length;
  gc.message("owner", "in the space", { group: true });
  await waitFor(async () => {
    const { rooms } = await env.client.call("channels.rooms", { channel: "gc" });
    return rooms.some((r) => r.id === "spaces/team" && r.name === "Team");
  }, "offered");
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(llm.calls.length, calls);

  await env.client.call("channels.set", {
    id: "gc",
    channel: {
      type: TYPE,
      agent_id: "roby",
      rooms: {
        rooms: [{ id: "spaces/team", name: "Team", mode: "mention" }],
        names: [],
        owner_only: false,
        knowledge: "",
        rules: "",
        reply_when: "",
        limits: { user_cooldown_s: 0, room_replies_per_hour: 30, checks_per_hour: 120 },
      },
    },
  });
  await running();
  gc.message("ana", "hello app", { group: true });
  await waitFor(() => gc.sentIn("spaces/team").length >= 1, "room answer");
  assert.equal(gc.sentIn("spaces/team")[0]?.body.thread?.name, "spaces/team/threads/t1");
});
