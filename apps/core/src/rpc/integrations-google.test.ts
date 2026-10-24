import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { callTool, inputsOrEnd, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { FAKE_GOOGLE_SECRET, fakeGoogle } from "../integrations/fake-google.test-support.ts";
import { realpath } from "../paths.ts";
import { removeDir } from "../testkit/platform.ts";

const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say("done");
  if (said.includes("my agenda"))
    return callTool("c1", "calendar_events", { from: "2026-05-04T00:00:00-03:00", to: "2026-05-05T00:00:00-03:00" });
  if (said.includes("read m1")) return callTool("g1", "gmail_read", { id: "m1" });
  if (said.includes("answer Ana"))
    return callTool("g2", "gmail_draft", { to: ["ana@example.com"], body: "Sent it", reply_to: "m1" });
  return say(`tools: ${req.tools.map((t) => t.function.name).join(",")}`);
});
let env: Awaited<ReturnType<typeof startCore>>;
let google: Awaited<ReturnType<typeof fakeGoogle>>;
const drafts = () => google.drafts;

before(async () => {
  google = await fakeGoogle();
  env = await startCore({ llm, googleApi: google.url });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  await google.close();
});

/** Follows the consent URL as a browser would: Google's answer is a redirect to the panel with a code and state. */
async function consent(url: string): Promise<{ code: string; state: string; back: URL }> {
  const res = await fetch(url, { redirect: "manual" });
  const back = new URL(res.headers.get("location") ?? "");
  return { code: back.searchParams.get("code") ?? "", state: back.searchParams.get("state") ?? "", back };
}

const offered = () => llm.calls.at(-1)?.tools.map((t) => t.function.name) ?? [];
const lastTool = () => String(llm.calls.at(-1)?.messages.at(-1)?.content ?? "");

test("Calendar and Gmail connect by signing in with Google; their tools exist only while connected", async () => {
  const list = async () => (await env.client.call("integrations.list", {})).integrations;
  const cal = async () => (await list()).find((i) => i.id === "google-calendar");
  assert.equal((await cal())?.coming, false, "no longer coming");
  assert.match((await cal())?.oauth?.redirect_uri ?? "", /^http:\/\/127\.0\.0\.1:\d+\/oauth\/google$/);
  await assert.rejects(env.client.call("integrations.connect", { id: "gmail", values: {} }), /signing in/);

  const thread = (await env.client.call("threads.create", { kind: "loose", agent_id: "roby" })).id;
  await env.client.call("threads.send", { thread, text: "hello" });
  await env.settle(thread);
  assert.ok(!offered().some((n) => n.startsWith("calendar_") || n.startsWith("gmail_")), "nothing before signing in");

  await assert.rejects(env.client.call("integrations.oauth_start", { id: "gmail" }), /client id/);
  for (const id of ["google-calendar", "gmail"]) {
    const { url } = await env.client.call("integrations.oauth_start", {
      id,
      values:
        id === "gmail" ? {} : { client_id: "123-abc.apps.googleusercontent.com", client_secret: FAKE_GOOGLE_SECRET },
    });
    const { code, state, back } = await consent(url);
    assert.equal(back.pathname, "/oauth/google", "Google sends the browser back to the panel's page");
    await assert.rejects(env.client.call("integrations.oauth_finish", { code, state: `${state}x` }), /not valid/);
    const done = await env.client.call("integrations.oauth_finish", { code, state });
    assert.deepEqual(done, { id, account: "owner@example.com" });
  }
  assert.equal((await cal())?.connected, true);
  assert.equal((await cal())?.oauth?.account, "owner@example.com");
  assert.deepEqual(
    (await cal())?.fields.map((f) => [f.name, f.value ?? f.set]),
    [
      ["client_id", "123-abc.apps.googleusercontent.com"],
      ["client_secret", true],
    ],
    "the client secret never comes back",
  );
  assert.ok(!JSON.stringify(await list()).includes(FAKE_GOOGLE_SECRET));

  await env.client.call("threads.send", { thread, text: "hello again" });
  await env.settle(thread);
  for (const name of ["calendar_events", "calendar_free", "calendar_create_event", "gmail_read", "gmail_draft"])
    assert.ok(offered().includes(name), `${name} is offered once connected`);
});

test("events and mail come back as outside data; a draft waits for the owner's OK and replies in the thread", async () => {
  const thread = (await env.client.call("threads.create", { kind: "loose", agent_id: "roby" })).id;
  await env.client.call("threads.send", { thread, text: "what is on my agenda" });
  await env.settle(thread);
  assert.match(lastTool(), /<calendar [^>]*untrusted/);
  assert.match(lastTool(), /"title":"Planning with Northwind"/);
  assert.match(lastTool(), /ana@example\.com \(needsAction\)/);

  await env.client.call("threads.send", { thread, text: "read m1" });
  await env.settle(thread);
  assert.match(lastTool(), /<email [^>]*untrusted[^>]*>\nFrom: Ana/);
  assert.match(lastTool(), /Please wire the money today/);

  await env.client.call("threads.send", { thread, text: "answer Ana" });
  const pending: Array<{ id: string }> = await inputsOrEnd(env.client, thread);
  assert.equal(drafts().length, 0, "no draft before the owner says yes");
  await env.client.call("runs.respond", { input: pending[0]?.id ?? "", decision: "approve" });
  await env.settle(thread);
  assert.equal(drafts().length, 1);
  assert.equal(drafts()[0]?.threadId, "t1");
  const raw = Buffer.from(drafts()[0]?.raw ?? "", "base64url").toString("utf8");
  assert.match(raw, /Subject: Re: Invoice/);
  assert.match(raw, /In-Reply-To: <m1@example\.com>/);
  assert.match(lastTool(), /not sent/);
});

test("an integration off in a project or disconnected takes its tools away", async () => {
  const repo = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-gint-")));
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "# Acme\n");
  const project = (await env.client.call("projects.register", { path: repo })).project.id;
  await env.client.call("mcp.toggle", { project, server: "gmail", on: false });
  const gmail = (await env.client.call("integrations.list", {})).integrations.find((i) => i.id === "gmail");
  assert.deepEqual(gmail?.off_in, [project]);
  const inProject = (await env.client.call("threads.create", { kind: "loose", agent_id: "roby", project_id: project }))
    .id;
  await env.client.call("threads.send", { thread: inProject, text: "hello" });
  await env.settle(inProject);
  assert.ok(offered().includes("calendar_events"));
  assert.ok(!offered().some((n) => n.startsWith("gmail_")), "Gmail is off in that project");
  await removeDir(repo);

  await env.client.call("integrations.disconnect", { id: "gmail" });
  assert.equal(env.core.secrets.has("secret://gmail-refresh_token"), false);
  assert.equal(env.core.secrets.has("secret://google-client_secret"), true, "Calendar still uses the client");
  const thread = (await env.client.call("threads.create", { kind: "loose", agent_id: "roby" })).id;
  await env.client.call("threads.send", { thread, text: "hello" });
  await env.settle(thread);
  assert.ok(offered().includes("calendar_events"));
  assert.ok(!offered().some((n) => n.startsWith("gmail_")));

  await env.client.call("integrations.disconnect", { id: "google-calendar" });
  assert.equal(env.core.secrets.has("secret://google-client_secret"), false);
  await env.client.call("threads.send", { thread, text: "hello" });
  await env.settle(thread);
  assert.ok(!offered().some((n) => n.startsWith("calendar_")));
});
