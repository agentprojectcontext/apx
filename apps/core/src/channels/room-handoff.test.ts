// DECISIONS.md#d-212: a room's turn has no tools. When the owner asks there for something that needs them, the room
// answer ends with HANDOFF: that line never reaches the room, and the owner's own message (never a member's) is done in
// Home and answered in private.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { OWNER_ID } from "../domain/persons.ts";
import { HOME_THREAD_ID } from "../domain/seed.ts";
import { handoffAnswer } from "../engine/room-handoff.ts";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { manualTimers, waitFor } from "../testkit/platform.ts";
import { discordAdapter } from "./discord.ts";
import { fakeDiscord } from "./fake-discord.test-support.ts";
import { fakeTelegram } from "./fake-telegram.test-support.ts";
import { telegramAdapter } from "./telegram.ts";

const TG_TOKEN = "123456:TEST-handoff";
const DC_TOKEN = "MTIzNDU2.fake.discord-handoff";
const OWNER_TG = { id: 4004, name: "Owner", username: "owner_acme" };
const ANA_TG = { id: 5005, name: "Ana", username: "ana_acme" };
const OWNER_DC = { id: "444", name: "Owner" };
const GROUP = -1001234500077;
const ROOM = "8101";

const roomSaid = (content: unknown) =>
  [...String(content).matchAll(/<room_message(?:\s[^>]*)?>([\s\S]*?)<\/room_message>/g)].at(-1)?.[1]?.trim() ?? "";

const llm = scriptedLlm((req, { system, said }) => {
  if (system.includes(", answering in #")) {
    const last = roomSaid(req.messages.at(-1)?.content);
    if (last.includes("file the report")) return say("On it, you will hear back in private.\n**HANDOFF**");
    if (last.includes("check the deploy")) return say("HANDOFF");
    return say("Room answer");
  }
  if (said.includes("Judge first")) return say("It is the owner: check the deploy.");
  if (said.includes("<delegation_result")) return say("Deploy checked: all green.");
  if (said.includes("file the report")) return say("Report filed.");
  return say("Hi there");
});

let env: Awaited<ReturnType<typeof startCore>>;
let tg: Awaited<ReturnType<typeof fakeTelegram>>;
let dc: Awaited<ReturnType<typeof fakeDiscord>>;
const timers = manualTimers();
const BURST = 5_000;

async function settled(send: () => unknown): Promise<void> {
  const armed = timers.armed();
  send();
  await waitFor(() => timers.armed() >= armed + 1, "the room saw the message");
  timers.tick(BURST);
}

const texts = (list: Array<{ body: Record<string, unknown> }>) => list.map((m) => String(m.body.text ?? ""));
const home = () => env.core.store.messages.list(HOME_THREAD_ID);
const homeSays = (s: string) => home().some((m) => m.parts.some((p) => p.type === "text" && p.text.includes(s)));

before(async () => {
  tg = await fakeTelegram(TG_TOKEN);
  dc = await fakeDiscord(DC_TOKEN);
  env = await startCore({
    llm,
    roomBurstMs: BURST,
    roomTimers: timers,
    channelAdapters: {
      telegram: (c, t) => telegramAdapter(c, t, tg.url),
      discord: (c, t) => discordAdapter(c, t, dc.urls),
    },
  });
  env.core.store.persons.owner();
  env.core.store.persons.link(OWNER_ID, { channel: "tg", external_id: String(OWNER_TG.id), label: "Telegram" });
  env.core.store.persons.link(OWNER_ID, { channel: "dc", external_id: OWNER_DC.id, label: "Discord" });
  const limits = { user_cooldown_s: 0, room_replies_per_hour: 30, checks_per_hour: 120 };
  await env.client.call("channels.set", {
    id: "tg",
    channel: {
      type: "telegram",
      agent_id: "superagent",
      rooms: { rooms: [{ id: String(GROUP), name: "Acme team", mode: "always" }], names: [], limits },
    },
    token: TG_TOKEN,
  });
  await env.client.call("channels.set", {
    id: "dc",
    channel: {
      type: "discord",
      agent_id: "superagent",
      rooms: { rooms: [{ id: ROOM, name: "help", mode: "always" }], names: [], limits },
    },
    token: DC_TOKEN,
  });
  await waitFor(
    async () => (await env.client.call("channels.list", {})).channels.every((c) => c.status === "running"),
    "running",
  );
  await waitFor(() => dc.identified.length > 0, "identified");
  // The owner talks to Home on Telegram: that is where they hear from it.
  tg.message(OWNER_TG, "hola");
  await waitFor(() => texts(tg.messagesTo(OWNER_TG.id)).includes("Hi there"), "Home answered on Telegram");
});
after(async () => {
  await env.core.close();
  await tg.close();
  await dc.close();
  await env.cleanup();
});

test("a HANDOFF last line is read with markdown around it and taken out", () => {
  assert.equal(handoffAnswer("On it.\n**HANDOFF**"), "On it.");
  assert.equal(handoffAnswer("HANDOFF."), "");
  assert.equal(handoffAnswer("I can hand off nothing\nhere"), undefined);
  assert.equal(handoffAnswer("Say HANDOFF to me"), undefined);
});

test("the owner's request in a group is done in Home and answered in private, never in the group", async () => {
  await settled(() => tg.message(OWNER_TG, "please file the report", { id: GROUP, type: "supergroup", title: "Acme" }));
  await waitFor(() => texts(tg.messagesTo(OWNER_TG.id)).includes("Report filed."), "the result in the owner's chat");
  const group = texts(tg.messagesTo(GROUP));
  assert.deepEqual(group, ["On it, you will hear back in private."]);
  const words = home().find(
    (m) =>
      m.author.kind === "user" &&
      m.via === "tg" &&
      m.parts.some((p) => p.type === "text" && p.text === "please file the report"),
  );
  assert.ok(words, "the owner's own words, as they wrote them, in Home");
  const run = env.core.store.runs
    .list(HOME_THREAD_ID, 20)
    .find((r) => r.input?.origin.kind === "user" && r.input.text.includes("please file the report"));
  assert.match(run?.input?.text ?? "", /#Acme team \(a public room on /);
});

test("a member's message never becomes a request, even when the room answer says HANDOFF", async () => {
  await settled(() => tg.message(ANA_TG, "file the report for me", { id: GROUP, type: "supergroup", title: "Acme" }));
  await waitFor(() => texts(tg.messagesTo(GROUP)).length === 2, "the room answer");
  assert.equal(texts(tg.messagesTo(GROUP))[1], "On it, you will hear back in private.");
  // The handoff is decided before the answer is posted, so Home already has it or never will.
  assert.equal(homeSays("file the report for me"), false);
  assert.ok(!texts(tg.messagesTo(GROUP)).some((t) => t.includes("HANDOFF")));
});

test("on Discord the owner's words from a room go through the super-agent's check, and the result comes in private", async () => {
  await settled(() => dc.message(OWNER_DC, "check the deploy please", { room: ROOM }));
  await waitFor(() => texts(tg.messagesTo(OWNER_TG.id)).includes("Deploy checked: all green."), "the checked result");
  // The answer was only the line: the room hears it is on its way, in the owner's language.
  assert.deepEqual(
    dc.messagesTo(ROOM).map((m) => m.body.content),
    ["Dale, me ocupo y te aviso por privado."],
  );
  const runs = env.core.store.runs.list(HOME_THREAD_ID, 50);
  assert.ok(!runs.some((r) => r.input?.origin.kind === "user" && r.input.text.includes("check the deploy")));
  const check = llm.calls.find((c) => String(c.messages.at(-1)?.content).includes("Judge first"));
  assert.match(String(check?.messages.at(-1)?.content), /in #help \(a public room on/);
  assert.match(String(check?.messages.at(-1)?.content), /trust="untrusted"/);
});
