import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { type InstanceFile, type InstancePlan, SUPER_AGENT_ID } from "@apx/protocol";
import type { FlowGraph } from "@apx/protocol/flow-graph";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { expandHome, samePath } from "../paths.ts";
import { tempDir } from "../testkit/platform.ts";
import { applyImport, ImportOutOfTime } from "./plan.ts";

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
  assert.equal(crm?.env.PLAIN, "", "a value typed as text travels empty");
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

test("a copy's read-only folders pass the owner's own check: APX's home never becomes one", async () => {
  const file = await exported();
  const there = homes[1]?.path as string;
  const crafted = {
    ...file,
    projects: [{ id: "p_crafted", name: "Crafted", read_only_folders: [there, os.tmpdir()] }],
  };
  await target.client.call("instance.import", { file: crafted });
  const p = target.core.store.projects.get("p_crafted");
  assert.equal(p?.present, false);
  assert.deepEqual(p?.read_only_folders ?? [], [], "neither APX's home nor the temp folder is kept");
});

test("a copy that changes what runs or where a key goes turns it off here, and a command never starts by itself", async () => {
  const file = await exported();
  const t = target.core.store;
  // Already here and on: the owner's server, channel, provider and routine.
  await target.client.call("instance.import", { file });
  const servers = JSON.parse(t.settings.get("mcp_servers") ?? "{}");
  servers.mcpServers.crm.enabled = true;
  t.settings.set("mcp_servers", JSON.stringify(servers));
  t.settings.write("providers", [
    {
      id: "acme",
      transport: "openai-chat",
      base_url: "https://api.example.com",
      key: "secret://acme_key",
      models: [],
      enabled: true,
    },
  ]);
  const brief = t.routines.list().find((r) => r.name === "Morning brief");
  const crafted = {
    ...file,
    mcps: file.mcps.map((m) => (m.name === "crm" ? { ...m, command: "other-mcp" } : m)),
    providers: [
      {
        id: "acme",
        transport: "openai-chat",
        base_url: "https://other.example.net",
        key: "secret://acme_key",
        models: [],
      },
    ],
    routines: [
      ...file.routines.map((r) => (r.id === brief?.id ? { ...r, prompt: "Something else" } : r)),
      {
        ...file.routines[0],
        id: "rtn_shell",
        name: "Sync",
        action: "shell" as const,
        pre_command: "echo hi",
        enabled: true,
      },
    ],
    projects: file.projects.map((p) => ({ ...p, autonomy: "total" as const })),
  };
  const preview = await target.client.call("instance.preview_import", { file: crafted });
  assert.equal(byId(preview, "mcps", "crm")?.reason, "changed");
  assert.equal(byId(preview, "providers", "acme")?.reason, "changed");
  assert.equal(byId(preview, "routines", "rtn_shell")?.reason, "runs_command");
  assert.equal(byId(preview, "projects", project)?.reason, "kept_here", "how far its agents go stays this computer's");
  await target.client.call("instance.import", { file: crafted });
  assert.equal(JSON.parse(t.settings.get("mcp_servers") ?? "{}").mcpServers.crm.enabled, false);
  const acme = t.settings.read("providers").find((p) => p.id === "acme");
  assert.equal(acme?.enabled, false, "its key is not sent to the new address until the owner looks");
  assert.equal(t.routines.get("rtn_shell")?.enabled, false);
  assert.equal(t.routines.get(brief?.id ?? "")?.enabled, false);
  assert.equal(t.projects.get(project)?.autonomy, "plan");
  const twice = { ...file, routines: [...file.routines, ...file.routines] };
  await assert.rejects(target.client.call("instance.preview_import", { file: twice }), /listed twice/);
});

test("a server's variable typed as text travels empty, and its address without a password", async () => {
  await source.client.call("mcp.set", {
    name: "db",
    server: { url: "https://admin:hunter22@db.example.com/mcp", env: { LEVEL: "debug", KEY: "secret://acme_key" } },
  });
  const file = await exported();
  const db = file.mcps.find((m) => m.name === "db");
  assert.equal(db?.url, "https://db.example.com/mcp");
  assert.deepEqual(db?.env, { LEVEL: "", KEY: "secret://acme_key" });
  assert.ok(!JSON.stringify(file).includes("hunter22"));
  await source.client.call("mcp.set", { name: "db", server: null });
});

test("a file over the usual request size previews and imports", async () => {
  const file = await exported();
  const page = "Northwind keeps its spring catalog in the shared drive. ".repeat(280);
  const notes = Array.from({ length: 100 }, (_v, i) => ({
    scope: "global" as const,
    text: `Note ${i}: ${page}`,
    source: "owner" as const,
  }));
  const big = { ...file, memory: [...file.memory, ...notes] };
  assert.ok(Buffer.byteLength(JSON.stringify(big)) > 1.5 * 1024 * 1024);
  const preview = await target.client.call("instance.preview_import", { file: big });
  assert.equal(preview.items.filter((i) => i.section === "memory" && i.label.startsWith("Note ")).length, 100);
  await target.client.call("instance.import", { file: big });
  assert.ok(target.core.store.memories.standing(1000).some((m) => m.text.startsWith("Note 99: ")));
});

test("an agent never arrives with Total: a new one takes its project's, one here keeps its own", async () => {
  const file = await exported();
  await target.client.call("instance.import", { file });
  const t = target.core.store;
  const nora = file.agents.find((a) => a.name === "Nora");
  assert.ok(nora);
  const here = t.agents.get(nora.id);
  assert.ok(here);
  t.agents.upsert({ ...here, autonomy: "plan" });
  const crafted = {
    ...file,
    agents: [
      ...file.agents.map((a) => (a.id === nora.id ? { ...a, autonomy: "total" as const } : a)),
      { ...nora, id: "agt_bold", name: "Bold", autonomy: "total" as const },
    ],
  };
  const preview = await target.client.call("instance.preview_import", { file: crafted });
  assert.equal(byId(preview, "agents", nora.id)?.action, "same", "only Total differs, and Total is not taken");
  await target.client.call("instance.import", { file: crafted });
  assert.equal(t.agents.get(nora.id)?.autonomy, "plan");
  assert.equal(t.agents.get("agt_bold")?.autonomy, undefined);
});

test("an agent's rules from a file never act outside or irreversibly without asking", async () => {
  const file = await exported();
  await target.client.call("instance.import", { file });
  const t = target.core.store;
  const nora = file.agents.find((a) => a.name === "Nora");
  assert.ok(nora);
  const here = t.agents.get(nora.id);
  assert.ok(here);
  t.agents.upsert({ ...here, rules: { irreversible: "ask" } });
  const loose = { read: "auto", write: "auto", outside: "auto", irreversible: "auto" } as const;
  const crafted = {
    ...file,
    agents: [
      ...file.agents.map((a) => (a.id === nora.id ? { ...a, rules: loose } : a)),
      { ...nora, id: "agt_loose", name: "Loose", rules: loose },
    ],
  };
  await target.client.call("instance.import", { file: crafted });
  assert.deepEqual(t.agents.get(nora.id)?.rules, { read: "auto", write: "auto", irreversible: "ask" });
  assert.deepEqual(t.agents.get("agt_loose")?.rules, { read: "auto", write: "auto" });
});

test("a new model API whose key is here arrives off: the file chooses where that key goes", async () => {
  await target.client.call("secrets.set", { name: "acme_key", value: "local-acme-value-91" });
  const file = await exported();
  const crafted = {
    ...file,
    providers: [
      {
        id: "northwind",
        transport: "openai-chat",
        base_url: "https://other.example.net",
        key: "secret://acme_key",
        models: [],
      },
    ],
  };
  const preview = await target.client.call("instance.preview_import", { file: crafted });
  assert.equal(byId(preview, "providers", "northwind")?.action, "add");
  assert.equal(byId(preview, "providers", "northwind")?.off, true);
  assert.equal(byId(preview, "providers", "northwind")?.reason, "uses_key");
  await target.client.call("instance.import", { file: crafted });
  assert.equal(target.core.store.settings.read("providers").find((p) => p.id === "northwind")?.enabled, false);
});

test("a key typed into a command, an address or a step's header travels as a reference", async () => {
  const c = source.client;
  const API = "nw9c2e71f04ab35d8e11";
  const TOKEN = "zz81ab27c3d4e5f6a7b8";
  const PATH_KEY = "a1B2c3D4e5F6g7H8i9J0k1L2";
  const HEADER = "kk55ab27c3d4e5f6a7b8";
  const bin = path.join(os.homedir(), "bin", "acme-mcp");
  await c.call("mcp.set", {
    name: "tools",
    server: { command: bin, args: ["--api-key", API, "--model=claude-x", `--token=${TOKEN}`, "serve"] },
  });
  await c.call("mcp.set", {
    name: "remote",
    server: { url: `https://mcp.example.com/${PATH_KEY}/sse?apikey=${TOKEN}&region=eu` },
  });
  const nora = (await c.call("agents.list", {})).agents.find((a) => a.name === "Nora");
  await c.call("routines.set", {
    name: "Sync CRM",
    agent: nora?.id ?? "",
    schedule: { kind: "cron", cron: "0 9 * * *" },
    prompt: "Sync",
    pre_command: `CRM_TOKEN=${TOKEN} sync-crm --password ${API} --verbose`,
    enabled: true,
  });
  const notify = (
    await c.call("flows.create", {
      project,
      name: "Notify",
      graph: { ...graph, nodes: [hook, { ...call, headers: [{ name: "X-Api-Key", value: HEADER }] }] },
    })
  ).flow.id;
  const file = await exported();
  const text = JSON.stringify(file);
  for (const v of [API, TOKEN, PATH_KEY, HEADER]) assert.ok(!text.includes(v), `${v} is not in the file`);
  assert.ok(!text.includes(os.homedir()), "no folder of this computer");
  const tools = file.mcps.find((m) => m.name === "tools");
  assert.match(tools?.command ?? "", /^~[/\\]/, "the command is written from the home, as ~");
  assert.ok(samePath(expandHome(tools?.command ?? ""), bin), "and names the same file back home");
  assert.deepEqual(tools?.args, [
    "--api-key",
    "secret://tools_api_key",
    "--model=claude-x",
    "--token=secret://tools_token",
    "serve",
  ]);
  assert.equal(
    file.mcps.find((m) => m.name === "remote")?.url,
    "https://mcp.example.com/secret://remote_url_key/sse?apikey=secret://remote_apikey&region=eu",
  );
  assert.equal(
    file.routines.find((r) => r.name === "Sync CRM")?.pre_command,
    "CRM_TOKEN=secret://sync_crm_crm_token sync-crm --password secret://sync_crm_password --verbose",
  );
  const step = file.flows.find((f) => f.definition.id === notify)?.graph?.nodes.find((n) => n.id === "enroll");
  assert.deepEqual(step && "headers" in step ? step.headers : undefined, [
    { name: "X-Api-Key", value: "secret://notify_x_api_key" },
  ]);

  const preview = await target.client.call("instance.preview_import", { file });
  for (const name of ["tools_api_key", "tools_token", "remote_url_key", "remote_apikey", "notify_x_api_key"])
    assert.ok(preview.secrets.includes(name), `${name} is named to fill here`);
  await target.client.call("instance.import", { file });
  const there = JSON.parse(target.core.store.settings.get("mcp_servers") ?? "{}").mcpServers.tools;
  assert.ok(samePath(there.command, bin), "the command is found under this computer's home");
  const again = await target.client.call("instance.preview_import", { file });
  assert.equal(byId(again, "mcps", "tools")?.action, "same");
  assert.equal(byId(again, "mcps", "remote")?.action, "same");
  const mine = await source.client.call("instance.preview_import", { file });
  assert.equal(
    byId(mine, "mcps", "tools")?.action,
    "same",
    "its own copy changes nothing on the computer it came from",
  );
  for (const name of ["tools", "remote"]) await c.call("mcp.set", { name, server: null });
});

test("a new skill never removes an owner's skill named like its temporary folder", async () => {
  const skills = path.join(homes[1]?.path as string, "skills");
  fs.mkdirSync(path.join(skills, "notes.importing"), { recursive: true });
  fs.writeFileSync(path.join(skills, "notes.importing", "SKILL.md"), "# Mine\n");
  const file = await exported();
  const crafted = { ...file, skills: [{ name: "notes", files: [{ path: "SKILL.md", text: "# Notes\n" }] }] };
  await target.client.call("instance.import", { file: crafted });
  assert.equal(fs.readFileSync(path.join(skills, "notes", "SKILL.md"), "utf8"), "# Notes\n");
  assert.equal(fs.readFileSync(path.join(skills, "notes.importing", "SKILL.md"), "utf8"), "# Mine\n");
});

test("an import that outlives its deadline stops and says so; importing again finishes it", async () => {
  const file = await exported();
  const tg = file.channels.find((ch) => ch.id === "tg");
  assert.ok(tg);
  const crafted = { ...file, channels: [{ ...tg, id: "tg_late", label: "Late bot" }] };
  const deadline = new AbortController();
  const deps = {
    store: target.core.store,
    secrets: target.core.secrets,
    home: homes[1]?.path as string,
    userHome: os.homedir(),
    version: "test",
    register: () => {},
    mcpChanged: () => {},
    nextFor: () => undefined,
  };
  // The channel never answers: the deadline passes while the import waits on it.
  const stuck = () => {
    deadline.abort();
    return new Promise<never>(() => {});
  };
  await assert.rejects(applyImport({ ...deps, setChannel: stuck }, crafted, deadline.signal), ImportOutOfTime);
  const done = await applyImport({ ...deps, setChannel: async () => {} }, crafted);
  assert.equal(byId(done, "channels", "tg_late")?.action, "add");
});
