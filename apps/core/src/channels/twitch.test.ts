// Twitch against a fake chat server: the secret, and the streamer's chat as a room through the manager. Only an
// @mention is answered (the room's mode), in the chat, as a reply to it; Twitch's RECONNECT connects again; a refused
// token stops the channel; there are no one-to-one chats to write to.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
import { type FakeTwitch, fakeTwitch } from "./fake-irc.test-support.ts";
import { twitchAdapter, twitchSecret } from "./twitch.ts";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CHANNEL = "#acme_stream";
const ROOMS = {
  rooms: [{ id: CHANNEL, name: CHANNEL, mode: "mention" as const }],
  names: [],
  owner_only: false,
  knowledge: "Acme streams game dev on Fridays.",
  rules: "",
  reply_when: "",
  limits: { user_cooldown_s: 0, room_replies_per_hour: 30, checks_per_hour: 120 },
};

test("the secret is the bot's login, its token with or without oauth: and the channel", () => {
  const token = "abcdefghijklmnopqrstuvwxyz0123";
  assert.deepEqual(twitchSecret(`ApxBot oauth:${token} #Acme_Stream`), {
    login: "apxbot",
    token,
    channel: "#acme_stream",
  });
  assert.deepEqual(twitchSecret(`apxbot ${token} acme_stream`), { login: "apxbot", token, channel: "#acme_stream" });
  assert.deepEqual(twitchSecret("apxbot short #acme_stream"), { login: "apxbot", channel: "#acme_stream" });
});

describe("twitch channel", () => {
  const llm = scriptedLlm((_req, { said }) => say(`Chat answer: ${said.split("\n").at(-1)?.slice(-40)}`));
  let env: Awaited<ReturnType<typeof startCore>>;
  let tw: FakeTwitch;
  const posts = () => tw.sent.filter((s) => s.to === CHANNEL);

  before(async () => {
    tw = await fakeTwitch(CHANNEL);
    env = await startCore({
      llm,
      roomBurstMs: 40,
      channelAdapters: { twitch: (c, s) => twitchAdapter(c, s, tw.url) },
    });
    await env.client.call("channels.set", {
      id: "twitch",
      channel: { type: "twitch", agent_id: "roby", rooms: ROOMS },
      token: `apxbot oauth:${tw.token} ${CHANNEL}`,
    });
    await waitFor(
      async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running",
      "running",
    );
  });
  after(async () => {
    await env.core.close();
    await tw.close();
    await env.cleanup();
  });

  test("the chat is offered as a room; only an @mention is answered, in the chat, as a reply to it", async () => {
    await waitFor(
      async () => (await env.client.call("channels.rooms", { channel: "twitch" })).rooms.some((r) => r.id === CHANNEL),
      "offered",
    );
    tw.message("viewer", "first time here, hi chat");
    await pause(200);
    assert.equal(posts().length, 0, "not called, not answered");
    const asked = tw.message("viewer", "@apxbot when is the next stream?");
    await waitFor(() => posts().length === 1, "answered when @mentioned");
    assert.equal(posts()[0]?.tags["reply-parent-msg-id"], asked);
    const room = env.core.store.threads.byConversation("twitch", CHANNEL);
    const kept = env.core.store.messages
      .list(room?.id ?? "")
      .map((m) => m.parts.map((p) => (p.type === "text" ? p.text : "")).join(""));
    assert.ok(kept.includes("when is the next stream?"), "the bot's own @mention is dropped");
    assert.ok(kept.includes("first time here, hi chat"), "the chat is kept for context");
  });

  test("RECONNECT connects again and the chat keeps working", async () => {
    tw.reconnect();
    await waitFor(() => tw.connections() === 2, "connected again");
    await waitFor(
      async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running",
      "running",
    );
    await pause(100);
    tw.message("viewer2", "@apxbot still there?");
    await waitFor(() => posts().length === 2, "answered after reconnecting");
  });
});

test("a refused token stops the channel; there is no one-to-one chat to write to", async () => {
  const tw = await fakeTwitch(CHANNEL);
  const config = { id: "twitch", type: "twitch", agent_id: "roby" } as Parameters<typeof twitchAdapter>[0];
  const io = { receive() {}, action() {}, status() {}, signal: new AbortController().signal };
  const bad = twitchAdapter(config, `apxbot oauth:${"z".repeat(30)} ${CHANNEL}`, tw.url);
  await assert.rejects(bad.start(io), /refused the bot's token/);
  await bad.stop();

  const good = twitchAdapter(config, `apxbot ${tw.token} ${CHANNEL}`, tw.url);
  assert.deepEqual(await good.start(io), { account: "apxbot" });
  await assert.rejects(good.send("viewer", { text: "hi" }), /whispers are not supported/);
  await good.stop();
  await tw.close();
});
