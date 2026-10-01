import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ApxClient, ApxError } from "@apx/protocol/client";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

const llm = scriptedLlm((_req, { said }) => say(`You asked: ${said.split("\n").at(-1)?.slice(0, 80)}`));
let env: Awaited<ReturnType<typeof startCore>>;
let app: ApxClient;
let token = "";

const refused = (p: Promise<unknown>, re: RegExp) =>
  assert.rejects(p, (e: unknown) => e instanceof ApxError && re.test(e.message));

before(async () => {
  env = await startCore({ llm });
  const made = await env.client.call("clients.create", { name: "Claude Code", scopes: ["chat"] });
  token = made.token;
  assert.match(token, /^apxc_[0-9a-f]{48}$/);
  app = new ApxClient({ url: env.core.url, clientToken: token });
});
after(async () => {
  await env.core.close();
  env.cleanup();
});

test("an outside app asks an agent in a chat of its own, and its words arrive as another app's", async () => {
  assert.ok((await app.call("agents.list", {})).agents.some((a) => a.id === "roby"));
  const t = await app.call("threads.create", { kind: "code", agent_id: "roby" });
  assert.equal(t.kind, "loose", "never a code thread");
  assert.equal(t.title, "Claude Code: Roby");
  await app.call("threads.send", { thread: t.id, text: "summarize the repo" });
  await env.settle(t.id);
  const input = String(llm.calls.at(-1)?.messages.at(-1)?.content);
  assert.match(input, /<agent_message from="Claude Code \(an outside app\)" trust="untrusted">\nsummarize the repo/);
  const { messages } = await app.call("threads.get", { thread: t.id });
  const part = messages.at(-1)?.parts[0];
  assert.match(part?.type === "text" ? part.text : "", /You asked/);
  const listed = (await env.client.call("clients.list", {})).clients[0];
  assert.ok(listed?.last_used_at, "its use is noted");
});

test("it reaches nothing else: other chats, other methods, the owner's controls", async () => {
  await refused(app.call("threads.get", { thread: "home" }), /only use the chats it started/);
  await refused(app.call("threads.send", { thread: "home", text: "hi" }), /only use the chats it started/);
  await refused(app.call("memory.list", {}), /outside what Claude Code may do/);
  await refused(app.call("browser.tabs", {}), /outside what Claude Code may do/);
  await refused(app.call("clients.create", { name: "x", scopes: ["chat"] }), /outside what Claude Code may do/);
});

test("a revoked or made-up token gets nothing", async () => {
  const fake = new ApxClient({ url: env.core.url, clientToken: "apxc_0000" });
  await refused(fake.call("agents.list", {}), /unknown or revoked/);
  const id = (await env.client.call("clients.list", {})).clients[0]?.id ?? "";
  assert.equal((await env.client.call("clients.revoke", { id })).revoked, true);
  await refused(app.call("agents.list", {}), /unknown or revoked/);
  assert.deepEqual((await env.client.call("clients.list", {})).clients, []);
});
