import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { FAKE_GOOGLE_SECRET, fakeGoogle } from "../integrations/fake-google.test-support.ts";
import { say, scriptedLlm, startCore } from "./testkit.ts";

const llm = scriptedLlm(() => say("Ana is waiting on the Northwind quote since this morning: answer her today?"));
let env: Awaited<ReturnType<typeof startCore>>;
let google: Awaited<ReturnType<typeof fakeGoogle>>;

before(async () => {
  google = await fakeGoogle();
  env = await startCore({ llm, googleApi: google.url });
});
after(async () => {
  await env.core.close();
  env.cleanup();
  await google.close();
});

/** Gmail on the owner's own client: the only one that can read the inbox. */
async function connectGmail() {
  const { url } = await env.client.call("integrations.oauth_start", {
    id: "gmail",
    values: { client: "own", client_id: "123-abc.apps.googleusercontent.com", client_secret: FAKE_GOOGLE_SECRET },
  });
  const back = new URL((await fetch(url, { redirect: "manual" })).headers.get("location") ?? "");
  await env.client.call("integrations.oauth_finish", {
    code: back.searchParams.get("code") ?? "",
    state: back.searchParams.get("state") ?? "",
  });
}

async function runMail(id: string) {
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

test("a mail routine calls its agent only when mail outside ads and social came since its last run, as data", async () => {
  const r = await env.client.call("routines.set", {
    name: "Important mail",
    agent: "roby",
    action: "mail",
    schedule: { kind: "cron", cron: "*/5 * * * *" },
    prompt: "Tell me only the mail that needs me soon.",
  });
  const calls = llm.calls.length;
  assert.equal((await runMail(r.id))?.model_called, false, "without Gmail it never calls the model");

  await connectGmail();
  assert.equal((await runMail(r.id))?.model_called, false, "the first run starts from now");
  assert.equal(llm.calls.length, calls);

  google.arrive({ id: "promo", from: "deals@example.com", subject: "50% off", labels: ["CATEGORY_PROMOTIONS"] });
  assert.equal((await runMail(r.id))?.model_called, false, "only ads came: no model");

  google.arrive({ id: "ana", from: "Ana <ana@example.com>", subject: "Northwind quote", labels: ["IMPORTANT"] });
  google.arrive({ id: "social", from: "friends@example.com", subject: "New follower", labels: ["CATEGORY_SOCIAL"] });
  const told = await runMail(r.id);
  assert.equal(llm.calls.length, calls + 1);
  const input = String(llm.calls.at(-1)?.messages.at(-1)?.content);
  assert.match(input, /Tell me only the mail that needs me soon\./);
  assert.match(input, /<emails count="1" trust="untrusted">\n\{"id":"ana","from":"Ana <ana@example\.com>"/);
  assert.match(input, /"gmail_important":true/);
  assert.doesNotMatch(input, /50% off|New follower/);
  assert.equal(told?.model_called, true);
  assert.equal(told?.delivered, true);

  const again = await runMail(r.id);
  assert.equal(again?.model_called, false, "the same mail is never read twice");
  assert.equal(llm.calls.length, calls + 1);
});
