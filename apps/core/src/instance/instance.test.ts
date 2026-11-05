import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { type InstanceFile, type InstancePlan, SUPER_AGENT_ID } from "@apx/protocol";
import type { FlowGraph } from "@apx/protocol/flow-graph";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { tempDir } from "../testkit/platform.ts";

type Env = Awaited<ReturnType<typeof startCore>>;

const SECRET = "tok-ACME-7f3a91c2d4e5";
const BOT_TOKEN = "123456789:AAEhBOweik6ad9r_QXMENQjcrGbqCr4K-ab";
const hook = { kind: "webhook" as const, id: "start", label: "Webhook" };
const call = {
  id: "enroll",
  kind: "http" as const,
  label: "Enroll",
  method: "POST" as const,
  url: "https://api.example.com/v1/enroll",
  headers: [{ name: "Authorization", value: "Bearer secret://acme_key" }],
  body: '{ "email": "$trigger.email" }',
  timeoutMs: 5000,
};
const graph: FlowGraph = {
  schemaVersion: 2,
  nodes: [hook, call],
  edges: [{ source: "start", target: "enroll" }],
  layout: [],
};

let source: Env;
let target: Env;
const homes = [tempDir("apx-export-a-"), tempDir("apx-export-b-")];
// A project whose folder the other computer does not have (removed once exported).
const away = tempDir("apx-export-away-");
let project = "";
let awayProject = "";
let flow = "";

before(async () => {
  source = await startCore({ llm: scriptedLlm(() => say("ok")), home: homes[0]?.path as string });
  target = await startCore({ llm: scriptedLlm(() => say("ok")), home: homes[1]?.path as string });
  const c = source.client;
  await c.call("secrets.set", { name: "acme_key", value: SECRET });
  project = (await c.call("projects.create", { name: "Northwind" })).project.id;
  await c.call("projects.update", { project, autonomy: "plan" });
  awayProject = (await c.call("projects.create", { name: "Acme", path: away.path })).project.id;
  // The owner pasted a key into a prompt: the export carries its name, never the key.
  const nora = await c.call("agents.create", {
    slug: "nora",
    name: "Nora",
    role: "sales",
    prompt: `Call the CRM with ${SECRET} when asked.`,
  });
  await c.call("mcp.set", {
    name: "crm",
    server: { command: "crm-mcp", args: [], env: { CRM_TOKEN: "secret://acme_key", PLAIN: SECRET }, enabled: true },
  });
  await c.call("channels.set", {
    id: "tg",
    channel: { type: "telegram", label: "Sales bot", enabled: false, agent_id: nora.id },
    token: BOT_TOKEN,
  });
  await c.call("routines.set", {
    name: "Morning brief",
    agent: nora.id,
    schedule: { kind: "cron", cron: "0 8 * * 1-5" },
    prompt: "Brief me",
    enabled: true,
  });
  await c.call("tables.create", { project, name: "leads", columns: ["email", "seats"] });
  await c.call("tables.write", { project, table: "leads", key: "l1", values: { email: "user@example.com", seats: 3 } });
  flow = (await c.call("flows.create", { project, name: "Enroll", graph })).flow.id;
  await c.call("memory.add", { scope: "global", text: "The owner prefers short answers." });
  await c.call("memory.add", { scope: "agent", agent: nora.id, text: "Northwind buys in spring." });
});

after(async () => {
  await source?.core.close();
  await target?.core.close();
  for (const h of [...homes, away]) await h.remove();
});

const exported = async (o: { chats?: boolean; rows?: boolean } = {}) =>
  (await source.client.call("instance.export", { chats: o.chats ?? false, rows: o.rows ?? false })).file;

const byId = (plan: InstancePlan, section: string, id: string) =>
  plan.items.find((i) => i.section === section && i.id === id);

test("no secret value is in an export, even one written into a prompt or a server's variables", async () => {
  const file = await exported({ rows: true, chats: true });
  const text = JSON.stringify(file);
  assert.ok(!text.includes(SECRET), "the key's value is not in the file");
  assert.ok(!text.includes(BOT_TOKEN), "the channel's token is not in the file");
  assert.ok(!text.includes("AAEhBOweik6ad9r"), "not even part of it");
  const crm = file.mcps.find((m) => m.name === "crm");
  assert.equal(crm?.env.CRM_TOKEN, "secret://acme_key", "a reference stays a reference");
  assert.equal(crm?.env.PLAIN, "secret://acme_key", "a pasted value becomes its name");
  assert.match(file.agents.find((a) => a.name === "Nora")?.prompt ?? "", /secret:\/\/acme_key/);
  assert.equal(file.format, "apx-instance");
  assert.deepEqual(file.includes, { chats: true, rows: true });
  assert.deepEqual(file.tables.find((t) => t.name === "leads")?.rows, [
    { key: "l1", value: { email: "user@example.com", seats: 3 } },
  ]);
  const plain = await exported();
  assert.equal(plain.tables.find((t) => t.name === "leads")?.rows, undefined, "rows only when asked");
  assert.deepEqual(plain.chats, [], "chats only when asked");
});

test("the preview says what an import does, and the import does just that; what needs a secret arrives off", async () => {
  const file = await exported({ rows: true });
  await away.remove();
  const preview = await target.client.call("instance.preview_import", { file });
  assert.equal(byId(preview, "mcps", "crm")?.action, "add");
  assert.equal(byId(preview, "mcps", "crm")?.off, true);
  assert.equal(byId(preview, "mcps", "crm")?.reason, "needs_secret");
  assert.equal(byId(preview, "channels", "tg")?.off, true);
  assert.equal(byId(preview, "flows", flow)?.reason, "draft");
  assert.equal(byId(preview, "projects", project)?.action, "add", "a folder found here is registered");
  assert.equal(byId(preview, "projects", project)?.reason, undefined);
  assert.equal(byId(preview, "projects", awayProject)?.reason, "folder_missing");
  assert.deepEqual(preview.secrets, ["acme_key"], "the secret to fill here");
  assert.equal(
    (await target.client.call("mcp.list", {})).servers.find((s) => s.name === "crm"),
    undefined,
  );

  const done = await target.client.call("instance.import", { file });
  assert.deepEqual(done.items, preview.items, "what was applied is what the preview said");
  assert.equal(done.applied, preview.items.filter((i) => i.action === "add" || i.action === "update").length);

  const t = target.core.store;
  const crm = t.settings.get("mcp_servers") ?? "";
  assert.equal(JSON.parse(crm).mcpServers.crm.enabled, false, "the server arrives off");
  assert.equal(JSON.parse(crm).mcpServers.crm.env.CRM_TOKEN, "secret://acme_key", "its reference kept, empty here");
  assert.equal(t.settings.read("channels").find((c) => c.id === "tg")?.enabled, false, "the channel arrives off");
  assert.equal(t.flows.get(flow)?.enabled, false, "the Flow arrives off");
  const doc = t.flowGraphs.get(flow);
  assert.equal(doc.published, null, "nothing runs until the owner publishes it");
  assert.deepEqual(
    doc.draft?.nodes.map((n) => n.id),
    ["start", "enroll"],
  );
  assert.equal(t.projects.get(project)?.present, true);
  assert.equal(t.projects.get(awayProject)?.present, false, "the project waits for its folder");
  assert.equal(t.projects.get(project)?.autonomy, "plan");
  assert.equal(t.routines.list().find((r) => r.name === "Morning brief")?.enabled, true);
  assert.deepEqual(t.flowTables.read(project, "leads", ["l1"]), { l1: { email: "user@example.com", seats: 3 } });
  assert.ok(t.memories.standing(100).some((m) => m.text === "Northwind buys in spring."));
  const nora = t.agents.list().find((a) => a.name === "Nora");
  assert.match(nora?.prompt ?? "", /secret:\/\/acme_key/);
});

test("importing the same file twice changes nothing the second time", async () => {
  const file = await exported({ rows: true });
  await target.client.call("instance.import", { file });
  const before = await target.client.call("instance.export", { chats: false, rows: true });
  const again = await target.client.call("instance.import", { file });
  assert.equal(again.applied, 0);
  assert.deepEqual(
    again.items.filter((i) => i.action === "add" || i.action === "update"),
    [],
    "every item is already here",
  );
  const after = await target.client.call("instance.export", { chats: false, rows: true });
  assert.deepEqual({ ...after.file, created_at: "" }, { ...before.file, created_at: "" });
});

test("the owner's chats travel only when ticked, as text, into a chat of their own", async () => {
  const thread = await source.client.call("threads.create", { kind: "agent", agent_id: SUPER_AGENT_ID });
  source.core.store.messages.add({
    thread_id: thread.id,
    author: { kind: "user" },
    parts: [{ type: "text", text: "Plan the spring offer" }],
  });
  const file = await exported({ chats: true });
  const preview = await target.client.call("instance.preview_import", { file });
  assert.equal(byId(preview, "chats", thread.id)?.action, "add");
  await target.client.call("instance.import", { file });
  const there = target.core.store.messages.list(thread.id);
  assert.deepEqual(
    there.map((m) => m.parts),
    [[{ type: "text", text: "Plan the spring offer" }]],
  );
  const again = await target.client.call("instance.preview_import", { file });
  assert.equal(byId(again, "chats", thread.id)?.action, "same");
});

test("a file from another version, or one that is not an export, is refused and says why", async () => {
  const file = await exported();
  const refused = async (f: unknown) => {
    try {
      await target.client.call("instance.preview_import", { file: f });
    } catch (err) {
      return err as { message: string; detail?: { reason?: string } };
    }
    assert.fail("the file was read");
  };
  const newer = await refused({ ...file, version: 2 });
  assert.equal(newer.detail?.reason, "other_version");
  assert.match(newer.message, /newer APX/);
  const older = await refused({ ...file, version: 0 });
  assert.equal(older.detail?.reason, "other_version");
  assert.equal((await refused({ hello: "world" })).detail?.reason, "not_export");
  const broken = await refused({ ...file, agents: [{ id: 3 }] } as unknown as InstanceFile);
  assert.equal(broken.detail?.reason, "unreadable");
  await assert.rejects(target.client.call("instance.import", { file: { ...file, version: 2 } }), /newer APX/);
});
