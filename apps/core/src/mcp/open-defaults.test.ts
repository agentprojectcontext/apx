// A server new to the owner lets agents use every tool; servers they had keep what they had (DECISIONS.md#d-279).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { tempDir } from "../testkit/platform.ts";
import { settingsCore } from "../tools/settings.test-support.ts";

const SERVER = path.join(import.meta.dirname, "fake-server.test-support.mjs");
const fake = { command: process.execPath, args: [SERVER] };

let h: Awaited<ReturnType<typeof settingsCore>>;
let dir: ReturnType<typeof tempDir>;
before(async () => {
  dir = tempDir("apx-mcp-open-");
  h = await settingsCore();
});
after(async () => {
  await h.env.core.close();
  await h.env.cleanup();
  await dir.remove();
});

const mode = async (server: string, project?: string) =>
  (
    await h.env.client.call("mcp.tools", {
      scope: project ? "project" : "global",
      server,
      ...(project ? { project } : {}),
    })
  ).mode;
const allowed = async (server: string) =>
  (await h.env.client.call("mcp.tools", { scope: "global", server })).tools.map((t) => [t.name, t.approved]);

test("a server added by the owner allows every tool; an edit keeps it so, and one set to ask stays asking", async () => {
  await h.env.client.call("mcp.set", { name: "notes", server: fake });
  assert.equal(await mode("notes"), "all");
  assert.deepEqual(await allowed("notes"), [
    ["echo", true],
    ["token", true],
  ]);

  // The owner changes it: what it runs changed, "allow all" stays.
  await h.env.client.call("mcp.set", { name: "notes", server: { ...fake, env: { NOTES: "1" } } });
  assert.equal(await mode("notes"), "all");

  await h.env.client.call("mcp.toolMode", { scope: "global", server: "notes", mode: "ask" });
  await h.env.client.call("mcp.set", { name: "notes", server: { ...fake, env: { NOTES: "2" } } });
  assert.equal(await mode("notes"), "ask");

  // Removed and added again: new once more.
  await h.env.client.call("mcp.set", { name: "notes", server: null });
  await h.env.client.call("mcp.set", { name: "notes", server: fake });
  assert.equal(await mode("notes"), "all");
});

test("a server the owner already had keeps asking: nothing is opened for it", async () => {
  // As an install from before saved it: no grant, no mark of having been opened.
  const saved = JSON.parse(h.env.core.store.settings.get("mcp_servers") ?? "{}") as { mcpServers?: object };
  h.env.core.store.settings.set(
    "mcp_servers",
    JSON.stringify({ mcpServers: { ...saved.mcpServers, older: { command: process.execPath, args: [SERVER] } } }),
  );
  assert.equal(await mode("older"), "ask");
  assert.deepEqual(await allowed("older"), [
    ["echo", false],
    ["token", false],
  ]);
});

test("a project's server: approving its file still asks the owner, and then every tool is allowed", async () => {
  fs.mkdirSync(path.join(dir.path, ".apx"), { recursive: true });
  fs.writeFileSync(path.join(dir.path, ".apx", "mcps.json"), JSON.stringify({ mcpServers: { repo: fake } }));
  const project = (await h.env.client.call("projects.register", { path: dir.path })).project.id;
  const listed = (await h.env.client.call("mcp.list", { project })).servers.find((s) => s.name === "repo");
  assert.equal(listed?.status, "needs-approval");
  await h.env.client.call("mcp.trust", { project, server: "repo", trusted: true });
  assert.equal(await mode("repo", project), "all");

  // The file changes: it waits for the owner again, and approving it keeps "allow all".
  fs.writeFileSync(
    path.join(dir.path, ".apx", "mcps.json"),
    JSON.stringify({ mcpServers: { repo: { ...fake, env: { NOTES: "1" } } } }),
  );
  const changed = (await h.env.client.call("mcp.list", { project })).servers.find((s) => s.name === "repo");
  assert.equal(changed?.status, "needs-approval");
  await h.env.client.call("mcp.trust", { project, server: "repo", trusted: true });
  assert.equal(await mode("repo", project), "all");

  // One the owner writes into the project from the panel is approved as written, and open too.
  await h.env.client.call("mcp.set", { name: "written", project, server: fake });
  assert.equal(await mode("written", project), "all");
});

test("the super-agent lists what each tool may do and, at the owner's word, makes chosen ones ask in Auto", async () => {
  await h.env.client.call("mcp.set", { name: "desk", server: fake });
  await h.env.client.call("mcp.tools", { scope: "global", server: "desk" });
  const listed = (await h.ask({ method: "mcp.list" })).answer;
  assert.match(listed, /- desk \(scope global\): every tool allowed, new ones too — echo, token/);
  assert.match(listed, /- older \(scope global\): every tool asks first — echo, token/);

  // In Auto, what the owner asked runs without a card.
  const block = { method: "mcp.toolMode", params: { scope: "global", server: "desk", mode: "all", ask: ["token"] } };
  assert.match((await h.ask(block)).answer, /^done/);
  assert.deepEqual(await allowed("desk"), [
    ["echo", true],
    ["token", false],
  ]);
  assert.equal(await mode("desk"), "some");
  assert.match(
    (await h.ask({ method: "mcp.list" })).answer,
    /- desk \(scope global\): allowed: echo; new ones ask first; asks first: token/,
  );

  // "Pasalas todas a permitidas": every tool, the one asking first included.
  const open = { method: "mcp.toolMode", params: { scope: "global", server: "older", mode: "all" } };
  assert.match((await h.ask(open)).answer, /^done/);
  assert.equal(await mode("older"), "all");

  // In Manual the same change shows the owner what it does first.
  const card = await h.card(
    { method: "mcp.toolMode", params: { scope: "global", server: "desk", mode: "all", ask: ["echo"] } },
    "deny",
  );
  assert.match(card.detail, /^Let agents run the tools of the MCP server desk without asking, except echo/);
  assert.deepEqual(await allowed("desk"), [
    ["echo", true],
    ["token", false],
  ]);

  // A tool the server does not have is refused before anything changes.
  const wrong = { method: "mcp.toolMode", params: { scope: "global", server: "desk", mode: "all", ask: ["nope"] } };
  assert.match((await h.ask(wrong)).answer, /no tool nope; its tools: echo, token/);
  assert.equal(await mode("desk"), "some");
});

test("an extension's server allows every tool once it is on; its settings and a turn off and on keep what the owner chose", async () => {
  const ext = path.join(dir.path, "notes-ext");
  fs.mkdirSync(ext);
  fs.writeFileSync(
    path.join(ext, "apx-extension.json"),
    JSON.stringify({
      manifest: 2,
      id: "notes_ext",
      name: "Notes",
      version: "1.0.0",
      settings: [{ name: "region", label: "Region", type: "string", required: false, default: "eu" }],
      mcp: { notes: { command: process.execPath, args: [SERVER], env: { NOTES_REGION: "setting://region" } } },
    }),
  );
  await h.env.client.call("extensions.install", { path: ext });
  await h.env.client.call("extensions.enable", { id: "notes_ext", enabled: true });
  assert.equal(await mode("notes_ext-notes"), "all");

  // A new value changes what the server runs with; "allow all" stays.
  await h.env.client.call("extensions.settings", { id: "notes_ext", values: { region: "us" } });
  assert.equal(await mode("notes_ext-notes"), "all");
  await h.env.client.call("extensions.enable", { id: "notes_ext", enabled: false });
  await h.env.client.call("extensions.enable", { id: "notes_ext", enabled: true });
  assert.equal(await mode("notes_ext-notes"), "all");

  // Once the owner made it ask, turning it off and on does not open it again.
  await h.env.client.call("mcp.toolMode", { scope: "global", server: "notes_ext-notes", mode: "ask" });
  await h.env.client.call("extensions.enable", { id: "notes_ext", enabled: false });
  await h.env.client.call("extensions.enable", { id: "notes_ext", enabled: true });
  assert.equal(await mode("notes_ext-notes"), "ask");
});
