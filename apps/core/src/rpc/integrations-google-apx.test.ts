import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { FAKE_GOOGLE_SECRET, fakeGoogle } from "../integrations/fake-google.test-support.ts";

const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say("done");
  if (said.includes("block my morning"))
    return callTool("c1", "calendar_create_event", {
      title: "Focus",
      start: "2026-05-04T09:00:00-03:00",
      end: "2026-05-04T11:00:00-03:00",
    });
  if (said.includes("meet Ana"))
    return callTool("c2", "calendar_create_event", {
      title: "Planning",
      start: "2026-05-05T15:00:00-03:00",
      end: "2026-05-05T16:00:00-03:00",
      attendees: ["ana@example.com"],
      meet: true,
    });
  if (said.includes("find the plan")) return callTool("d1", "drive_search", { q: "plan" });
  return say(`tools: ${req.tools.map((t) => t.function.name).join(",")}`);
});
let env: Awaited<ReturnType<typeof startCore>>;
let google: Awaited<ReturnType<typeof fakeGoogle>>;

before(async () => {
  google = await fakeGoogle();
  env = await startCore({
    llm,
    googleApi: google.url,
    googleClient: `apx.apps.googleusercontent.com:${FAKE_GOOGLE_SECRET}`,
  });
});
after(async () => {
  await env.core.close();
  env.cleanup();
  await google.close();
});

async function signIn(id: string) {
  const { url } = await env.client.call("integrations.oauth_start", { id, values: { client: "apx" } });
  assert.equal(new URL(url).searchParams.get("client_id"), "apx.apps.googleusercontent.com");
  const back = new URL((await fetch(url, { redirect: "manual" })).headers.get("location") ?? "");
  const code = back.searchParams.get("code") ?? "";
  return env.client.call("integrations.oauth_finish", { code, state: back.searchParams.get("state") ?? "" });
}

const offered = () => llm.calls.at(-1)?.tools.map((t) => t.function.name) ?? [];
const lastTool = () => String(llm.calls.at(-1)?.messages.at(-1)?.content ?? "");

test("with the client APX ships, Calendar, Drive and Gmail's sending connect with nothing typed by the owner", async () => {
  const drive = async () =>
    (await env.client.call("integrations.list", {})).integrations.find((i) => i.id === "google-drive");
  assert.equal((await drive())?.oauth?.builtin, true);
  assert.deepEqual(await signIn("google-drive"), { id: "google-drive", account: "owner@example.com" });
  await signIn("google-calendar");
  assert.equal((await drive())?.oauth?.client, "apx");
  assert.equal(env.core.secrets.has("secret://google-client_secret"), false, "nothing of the owner's is stored");
  assert.ok(!JSON.stringify(await env.client.call("integrations.list", {})).includes(FAKE_GOOGLE_SECRET));

  const thread = (await env.client.call("threads.create", { kind: "loose", agent_id: "roby" })).id;
  await env.client.call("threads.send", { thread, text: "hello" });
  await env.settle(thread);
  for (const name of ["drive_search", "drive_read", "drive_write_doc", "drive_share", "calendar_cancel_event"])
    assert.ok(offered().includes(name), `${name} is offered once connected`);
  assert.ok(!offered().some((n) => n.startsWith("gmail_")), "Gmail is not connected");

  await signIn("gmail");
  await env.client.call("threads.send", { thread, text: "hello" });
  await env.settle(thread);
  assert.ok(offered().includes("gmail_send"), "APX's sign-in sends mail");
  for (const name of ["gmail_search", "gmail_read", "gmail_draft", "gmail_send_draft"])
    assert.ok(!offered().includes(name), `${name} needs the owner's own client`);

  await env.client.call("threads.send", { thread, text: "find the plan" });
  await env.settle(thread);
  assert.match(lastTool(), /<files [^>]*untrusted/);
  assert.match(lastTool(), /"name":"Northwind plan","type":"doc"/);
});

test("an event only on the owner's calendar goes in without asking; inviting someone waits for the owner's OK", async () => {
  const thread = (await env.client.call("threads.create", { kind: "loose", agent_id: "roby" })).id;
  await env.client.call("threads.send", { thread, text: "block my morning" });
  await env.settle(thread);
  assert.equal(google.created.length, 1);
  assert.deepEqual(google.created[0], {
    summary: "Focus",
    start: { dateTime: "2026-05-04T09:00:00-03:00" },
    end: { dateTime: "2026-05-04T11:00:00-03:00" },
    sendUpdates: null,
  });

  await env.client.call("threads.send", { thread, text: "meet Ana" });
  let pending: Array<{ id: string }> = [];
  for (let i = 0; i < 80 && !pending.length; i++) {
    pending = (await env.client.call("runs.pending", { thread })).inputs;
    if (!pending.length) await new Promise((r) => setTimeout(r, 25));
  }
  assert.equal(pending.length, 1, "the invitation waits");
  assert.equal(google.created.length, 1, "nothing sent before the owner says yes");
  await env.client.call("runs.respond", { input: pending[0]?.id ?? "", decision: "approve" });
  await env.settle(thread);
  assert.equal(google.created.length, 2);
  assert.deepEqual(google.created[1]?.attendees, [{ email: "ana@example.com" }]);
  assert.equal(google.created[1]?.sendUpdates, "all");
});
