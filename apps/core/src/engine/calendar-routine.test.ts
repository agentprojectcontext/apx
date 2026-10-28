import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { FAKE_GOOGLE_SECRET, fakeGoogle } from "../integrations/fake-google.test-support.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

const llm = scriptedLlm(() => say("Doctor at 18:20, in 25 minutes, at the clinic."));
let env: Awaited<ReturnType<typeof startCore>>;
let google: Awaited<ReturnType<typeof fakeGoogle>>;

before(async () => {
  google = await fakeGoogle();
  env = await startCore({ llm, googleApi: google.url });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  await google.close();
});

async function connectCalendar() {
  const { url } = await env.client.call("integrations.oauth_start", {
    id: "google-calendar",
    values: { client_id: "123-abc.apps.googleusercontent.com", client_secret: FAKE_GOOGLE_SECRET },
  });
  const back = new URL((await fetch(url, { redirect: "manual" })).headers.get("location") ?? "");
  await env.client.call("integrations.oauth_finish", {
    code: back.searchParams.get("code") ?? "",
    state: back.searchParams.get("state") ?? "",
  });
}

async function runOnce(id: string) {
  const started = await env.client.call("routines.run", { routine: id });
  await env.settle(started.thread_id);
  const end = Date.now() + 4000;
  let runs = (await env.client.call("routines.runs", { routine: id })).runs;
  while (runs[0]?.delivered === undefined && Date.now() < end) {
    await new Promise((res) => setTimeout(res, 25));
    runs = (await env.client.call("routines.runs", { routine: id })).runs;
  }
  return runs[0];
}

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

test("event reminders call the agent only for an event about to start, once, with the events as data", async () => {
  const r = await env.client.call("secretary.set", { action: "calendar", enabled: true });
  assert.equal(r.action, "calendar");
  assert.equal(r.origin, "secretary:events", "the secretary profile's own routine");
  assert.equal(r.anchor, true, "a reminder is never held by the daily cap");
  const calls = llm.calls.length;
  assert.equal((await runOnce(r.id))?.model_called, false, "without Calendar it never calls the model");

  await connectCalendar();
  google.schedule({ id: "later", summary: "Dinner", start: { dateTime: inMinutes(180) } });
  google.schedule({
    id: "declined",
    summary: "Standup",
    start: { dateTime: inMinutes(10) },
    attendees: [{ email: "owner@example.com", self: true, responseStatus: "declined" }],
  });
  assert.equal((await runOnce(r.id))?.model_called, false, "nothing the owner goes to starts soon");

  google.schedule({ id: "doctor", summary: "Doctor", location: "Clinic", start: { dateTime: inMinutes(20) } });
  const told = await runOnce(r.id);
  assert.equal(llm.calls.length, calls + 1);
  const input = String(llm.calls.at(-1)?.messages.at(-1)?.content);
  assert.match(input, /<events count="1" trust="untrusted">\n\{"title":"Doctor"/);
  assert.match(input, /"location":"Clinic"/);
  assert.doesNotMatch(input, /Dinner|Standup|Planning with Northwind/);
  assert.equal(told?.model_called, true);
  assert.equal(told?.delivered, true);

  assert.equal((await runOnce(r.id))?.model_called, false, "an event is reminded once");
  assert.equal(llm.calls.length, calls + 1);
});
