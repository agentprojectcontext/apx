import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ProviderError } from "../providers/types.ts";
import { resetLabel } from "./provider-limit.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

let now = new Date("2026-03-02T10:00:00Z");
/** A time on the test clock's day: each test that counts notices starts on a day of its own, past earlier stalls. */
const on = (hhmm: string) => `${now.toISOString().slice(0, 10)}T${hhmm}:00.000Z`;

const llm = scriptedLlm((_req, { said }) => {
  if (said.includes("limited later"))
    throw new ProviderError("quota", "fake/fake-1: HTTP 429: usage_limit_reached", on("20:00"));
  if (said.includes("limited"))
    throw new ProviderError("quota", "fake/fake-1: HTTP 429: usage_limit_reached", on("14:30"));
  if (said.includes("unsaid")) throw new ProviderError("rate_limit", "fake/fake-1: HTTP 429: slow down");
  if (said.includes("broken")) throw new ProviderError("auth", "fake/fake-1: HTTP 401: bad key");
  return say("Done.");
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm, clock: () => now, unseenAfterMs: 50 });
  // The owner's time zone is where the reset is told.
  env.core.store.settings.write("owner_profile", { ...env.core.store.settings.read("owner_profile"), timezone: "UTC" });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

async function turn(text: string) {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: t.id, text });
  return { id: t.id, ...(await env.settle(t.id)) };
}
const stallNotices = () =>
  env.core.store.notifications
    .list({ unreadOnly: false, limit: 100 })
    .filter((n) => n.title === "Model provider limit" || n.title === "Límite del proveedor de modelos");
const stallNudges = () => env.core.store.nudges.list(100).filter((n) => n.kind === "provider-limit");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("a run a provider limit stopped keeps the reset and a reason of its own, and says when it lifts", async () => {
  const t = await turn("limited: write the report");
  const run = t.runs[0];
  assert.equal(run?.state, "failed");
  assert.equal(run?.end_reason, "provider_limit");
  assert.equal(run?.resets_at, on("14:30"));
  // Told in the owner's time zone, with the date when it is not today.
  assert.match(run?.error ?? "", /usage limit, which lifts at (2026-03-02 )?14:30\./);
  const notice = t.messages.at(-1)?.parts.find((p) => p.type === "notice");
  assert.equal(notice?.type === "notice" && notice.code, "run.noModel");
  assert.equal(notice?.type === "notice" && notice.vars?.variant, "limit");
  assert.match(String(notice?.type === "notice" && notice.vars?.until), /^(2026-03-02 )?14:30$/);
  assert.match(notice?.type === "notice" ? (notice.detail ?? "") : "", /usage_limit_reached/);
  const thread = await env.client.call("threads.get", { thread: t.id });
  assert.match(thread.thread.preview ?? "", /lifts at (2026-03-02 )?14:30/);
});

test("other failures keep their own reason", async () => {
  const t = await turn("broken: write the report");
  assert.equal(t.runs[0]?.end_reason, "failed");
  assert.equal(t.runs[0]?.resets_at, undefined);
  const notice = t.messages.at(-1)?.parts.find((p) => p.type === "notice");
  assert.deepEqual(notice?.type === "notice" && notice.vars, {});
});

test("the owner hears once per stall, not once per stopped run; a new stall after the reset is told again", async () => {
  now = new Date("2026-03-03T10:00:00Z");
  const before = stallNotices().length;
  const nudgesBefore = stallNudges().length;
  await turn("limited: task one");
  // Another agent answering (on another provider, say) does not end the stall.
  await turn("hello");
  await turn("limited: task two");
  await turn("limited later: task three");
  await wait(150);
  const told = stallNotices().slice(0, stallNotices().length - before);
  assert.equal(told.length, 1);
  assert.match(told[0]?.body ?? "", /14:30/);
  assert.equal(stallNudges().length - nudgesBefore, 1);
  // The per-chat "a turn failed unseen" notice does not repeat it for each chat.
  assert.ok(
    !env.core.store.notifications
      .list({ unreadOnly: false, limit: 100 })
      .some((n) => n.kind === "run" && /usage limit/.test(n.body)),
  );
  // Past the reset the limit is hit again: that is a new stall.
  now = new Date("2026-03-03T15:00:00Z");
  await turn("limited later: task four");
  assert.equal(stallNotices().length - before, 2);
  assert.match(stallNotices()[0]?.body ?? "", /20:00/);
});

test("a limit with no reset said is still a provider limit, told without a time", async () => {
  now = new Date("2026-03-04T10:00:00Z");
  const t = await turn("unsaid: go");
  assert.equal(t.runs[0]?.end_reason, "provider_limit");
  assert.equal(t.runs[0]?.resets_at, undefined);
  const notice = t.messages.at(-1)?.parts.find((p) => p.type === "notice");
  assert.deepEqual(notice?.type === "notice" && notice.vars, { variant: "limitUnknown" });
  assert.match(stallNotices()[0]?.body ?? "", /did not say until when|no dijo hasta cuándo/);
});

test("a reset is shown as the time today, with the date on another day", () => {
  const today = new Date("2026-03-02T10:00:00Z");
  assert.equal(resetLabel("2026-03-02T14:30:00Z", "UTC", today), "14:30");
  assert.equal(resetLabel("2026-03-03T09:05:00Z", "UTC", today), "2026-03-03 09:05");
  assert.equal(resetLabel("2026-03-02T14:30:00Z", "America/Argentina/Buenos_Aires", today), "11:30");
});

test("a routine a provider limit stopped is not reported on its own: the stall notice covers it", async () => {
  const r = await env.client.call("routines.set", {
    name: "Brief",
    agent: "roby",
    schedule: { kind: "manual" },
    prompt: "limited: the morning brief",
  });
  await env.client.call("routines.run", { routine: r.id });
  const until = Date.now() + 5000;
  let runs = (await env.client.call("routines.runs", { routine: r.id })).runs;
  while (!runs[0]?.ended_at && Date.now() < until) {
    await wait(25);
    runs = (await env.client.call("routines.runs", { routine: r.id })).runs;
  }
  assert.equal(runs[0]?.state, "failed");
  await wait(100);
  runs = (await env.client.call("routines.runs", { routine: r.id })).runs;
  assert.equal(runs[0]?.delivered, false);
  assert.ok(!env.core.store.nudges.list(100).some((n) => n.kind === "routine:Brief"));
});
