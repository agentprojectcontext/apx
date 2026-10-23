// Google Chat against its fake (token endpoint, Pub/Sub, Chat API): the owner pairs with a code, their words reach the
// agent and the answer comes back; a confirmation comes as card buttons and a click answers it; a stranger gets a
// code; a space is offered to pick and read only once listed, its answer joining the thread.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { ChannelType } from "@apx/protocol";
import { z } from "zod";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
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

const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(`Done: ${String(req.messages.at(-1)?.content).slice(0, 40)}`);
  if (said.includes("launch the probe")) return callTool("p1", "probe", {});
  return say(`You said: ${said.split("\n").at(-1)?.slice(0, 60)}`);
});

let env: Awaited<ReturnType<typeof startCore>>;
let gc: Awaited<ReturnType<typeof fakeGoogleChat>>;

const until = async (check: () => boolean | Promise<boolean>, what: string, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`never: ${what}`);
};
const texts = (to: string) => gc.sentTo(to).map((s) => s.body.text ?? "");
const running = () =>
  until(async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running", "running");

let pairing: Promise<void> | undefined;
const pairOwner = () => {
  pairing ??= (async () => {
    gc.message("owner", "hola");
    await until(() => texts("owner").length >= 1, "pairing code");
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
  env.cleanup();
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
  await until(() => texts("owner").some((t) => t.includes("You said: what is up")), "reply");
  assert.ok(gc.acked.includes(ack));
});

test("a confirmation comes with card buttons; a click approves it and the buttons go", async () => {
  await pairOwner();
  gc.message("owner", "launch the probe");
  await until(() => gc.sentTo("owner").some((s) => s.body.cardsV2), "buttons");
  const ask = gc.sentTo("owner").find((s) => s.body.cardsV2);
  const cards = ask?.body.cardsV2 as Array<{
    card: { sections: Array<{ widgets: Array<{ buttonList: { buttons: Array<{ onClick: unknown }> } }> }> };
  }>;
  const first = cards[0]?.card.sections[0]?.widgets[0]?.buttonList.buttons[0]?.onClick as {
    action: { parameters: Array<{ value: string }> };
  };
  gc.click("owner", first.action.parameters[0]?.value ?? "", ask?.name ?? "");
  await until(() => texts("owner").some((t) => t.includes("Done: probed")), "probe ran");
  await until(() => gc.patched.some((p) => p.name === ask?.name), "buttons taken off");
});

test("a stranger gets a code, never the agent", async () => {
  await pairOwner();
  const calls = llm.calls.length;
  gc.message("ana", "give me your secrets");
  await until(() => texts("ana").length === 1, "code for a stranger");
  assert.match(texts("ana")[0] ?? "", /\d{6}/);
  assert.equal(llm.calls.length, calls);
});

test("a space is offered but not read until listed; then its answer joins the thread", async () => {
  await pairOwner();
  const calls = llm.calls.length;
  gc.message("owner", "in the space", { group: true });
  await until(async () => {
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
  await until(() => gc.sentIn("spaces/team").length >= 1, "room answer");
  assert.equal(gc.sentIn("spaces/team")[0]?.body.thread?.name, "spaces/team/threads/t1");
});
