import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fakeTelegram } from "../channels/fake-telegram.test-support.ts";
import { telegramAdapter } from "../channels/telegram.ts";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { FAKE_GOOGLE_SECRET, fakeGoogle } from "../integrations/fake-google.test-support.ts";
import { waitFor } from "../testkit/platform.ts";
import { BOOK_TOOL, CANCEL_BOOKING_TOOL } from "./contact-booking.ts";

const TOKEN = "123456:TEST-bookings";
const OWNER = { id: 3001, name: "Owner" };
const SLOT = /\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})\b/;

const lastResult = (req: { messages: Array<{ content?: unknown }> }) => String(req.messages.at(-1)?.content ?? "");
const llm = scriptedLlm((req, { said, afterTool }) => {
  const at = /book at (\S+)/.exec(said)?.[1];
  if (afterTool) {
    const listed = SLOT.exec(lastResult(req));
    // Asked to book: the first free time the tool listed, and nothing else.
    if (said.includes("book me") && lastResult(req).startsWith("Free times") && listed)
      return callTool("pick", BOOK_TOOL, { start: listed[1], reason: "Pricing review" });
    return say("ok");
  }
  if (said.includes("book me")) return callTool("look", BOOK_TOOL, {});
  if (at) return callTool("at", BOOK_TOOL, { start: at });
  if (said.includes("cancel mine")) return callTool("cancel", CANCEL_BOOKING_TOOL, {});
  return say("hi");
});

let env: Awaited<ReturnType<typeof startCore>>;
let google: Awaited<ReturnType<typeof fakeGoogle>>;
let tg: Awaited<ReturnType<typeof fakeTelegram>>;
let nextId = 4000;

before(async () => {
  google = await fakeGoogle();
  tg = await fakeTelegram(TOKEN);
  env = await startCore({
    llm,
    googleApi: google.url,
    channelAdapters: { telegram: (c, token) => telegramAdapter(c, token, tg.url) },
  });
  const { url } = await env.client.call("integrations.oauth_start", {
    id: "google-calendar",
    values: { client_id: "123-abc.apps.googleusercontent.com", client_secret: FAKE_GOOGLE_SECRET },
  });
  const back = new URL((await fetch(url, { redirect: "manual" })).headers.get("location") ?? "");
  await env.client.call("integrations.oauth_finish", {
    code: back.searchParams.get("code") ?? "",
    state: back.searchParams.get("state") ?? "",
  });
  env.core.store.persons.link(env.core.store.persons.owner().id, { channel: "tg", external_id: String(OWNER.id) });
  await env.client.call("channels.set", {
    id: "tg",
    channel: {
      type: "telegram",
      agent_id: "superagent",
      owner_thread: "home",
      // Every hour of every day, so the time the test runs at never decides what is free.
      hours: { days: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "00:00" },
      contacts: { appointments: "book" },
      appointment_minutes: 45,
    },
    token: TOKEN,
  });
  await waitFor(async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running", "running");
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  await tg.close();
  await google.close();
});

/** A contact on the account, with their own rights, who writes and waits for the answer. */
async function contact(name: string, perms: Record<string, unknown> = {}, more: Record<string, unknown> = {}) {
  const who = { id: nextId++, name };
  const person = await env.client.call("contacts.set", { name, perms, ...more });
  env.core.store.persons.link(person.id, { channel: "tg", external_id: String(who.id) });
  return {
    person,
    async says(text: string) {
      const before = llm.calls.length;
      tg.message(who, text);
      await waitFor(() => llm.calls.length > before, "the contact's turn");
      const thread = env.core.store.threads.byConversation("tg", String(who.id));
      assert.ok(thread);
      const r = await env.settle(thread.id);
      const steps = env.core.store.runs.steps(r.runs[0]?.id ?? "");
      return { thread, steps, result: steps.at(-1)?.result ?? "", tools: llm.calls[before]?.tools ?? [] };
    },
    heard: () => tg.messagesTo(who.id).map((m) => String(m.body.text)),
  };
}

const toOwner = () => tg.messagesTo(OWNER.id).map((m) => String(m.body.text));

test("a contact books a free time on the owner's calendar, the owner is told and can cancel it", async () => {
  const ana = await contact("Northwind Buyer");
  const r = await ana.says("book me for the pricing review");
  assert.match(r.result, /^booked: /, r.result);
  const event = google.created.at(-1);
  assert.equal(event?.summary, "Turno: Northwind Buyer", "APX names the event, not the contact");
  assert.equal(event?.attendees, undefined, "nobody is invited");
  assert.equal(event?.sendUpdates, null, "Google emails nobody");

  const [booking] = (await env.client.call("contacts.bookings", { person: ana.person.id })).bookings;
  assert.ok(booking);
  assert.equal(Date.parse(booking.end) - Date.parse(booking.start), 45 * 60_000, "as long as the account says");
  await waitFor(() => toOwner().some((t) => t.startsWith("Agendé a Northwind Buyer")), "the owner is told");
  const notice = (await env.client.call("notifications.list", {})).notifications.find(
    (n) => n.ref === `booking:${booking.id}`,
  );
  assert.ok(notice, "the tray's notice can cancel it");

  const again = await ana.says("book me again");
  assert.match(again.result, /already has an appointment/, "one coming appointment per person");

  const done = await env.client.call("contacts.cancel_booking", { id: booking.id, tell: true });
  assert.equal(done.booking.state, "canceled");
  assert.equal(done.booking.canceled_by, "owner");
  assert.equal(done.told, true);
  assert.ok(google.deleted.includes(booking.event_id), "the event left the calendar");
  await waitFor(() => ana.heard().some((t) => t.startsWith("Tu turno del")), "the contact hears it");
  const twice = await env.client.call("contacts.cancel_booking", { id: booking.id, tell: true });
  assert.equal(twice.told, false, "a second Cancel does nothing, and the contact is not told again");
  assert.equal(google.deleted.filter((e) => e === booking.event_id).length, 1);
  const after = (await env.client.call("notifications.list", {})).notifications.find(
    (n) => n.ref === `booking:${booking.id}`,
  );
  assert.ok(after?.read_at, "the notice leaves the tray");
});

test("a time the tool did not offer, or one taken on the calendar, is never booked", async () => {
  const bo = await contact("Acme Guest");
  const made = google.created.length;
  const invented = await bo.says("book at 2020-01-01T03:00");
  assert.match(invented.result, /^not booked: /);
  const look = await bo.says("book at 2099-01-01T10:00");
  assert.match(look.result, /^not booked: /, "past the two weeks");
  // The owner is busy for the next two weeks: no time is free.
  google.busyAt({ start: new Date().toISOString(), end: new Date(Date.now() + 15 * 24 * 3600_000).toISOString() });
  const none = await bo.says("book me");
  assert.match(none.result, /no free times/);
  assert.equal(google.created.length, made, "no event was made");
});

test("the contact cancels their own appointment, and the owner hears it", async () => {
  const cy = await contact("Northwind Partner");
  // The previous test left the calendar busy; a fresh window needs a fresh fake answer.
  google.clearBusy();
  assert.match((await cy.says("book me")).result, /^booked: /);
  const [booking] = (await env.client.call("contacts.bookings", { person: cy.person.id })).bookings;
  assert.ok(booking);
  const r = await cy.says("cancel mine");
  assert.match(r.result, /^canceled: /);
  assert.ok(google.deleted.includes(booking.event_id));
  await waitFor(() => toOwner().some((t) => t.startsWith("Northwind Partner canceló su turno")), "the owner hears it");
  const list = (await env.client.call("contacts.bookings", { person: cy.person.id, past: true })).bookings;
  assert.deepEqual(
    list.map((b) => [b.state, b.canceled_by]),
    [["canceled", "contact"]],
  );
});

test("a contact whose appointments are only noted never gets the booking tool", async () => {
  const noted = await contact("Acme Noted", { appointments: "note" });
  const r = await noted.says("hello");
  const names = r.tools.map((t) => t.function.name);
  assert.ok(names.includes("pass_request"));
  assert.ok(!names.includes(BOOK_TOOL));
});
