import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";

const SERVER = path.join(import.meta.dirname, "fake-server.test-support.mjs");

const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(`Result: ${String(req.messages.at(-1)?.content).slice(0, 300)}`);
  if (said.includes("use echo")) return callTool("e1", "mcp_notes_echo", { text: "hi" });
  if (said.includes("use token")) return callTool("e2", "mcp_mine_token", {});
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
let root = "";
let project = "";
const writeServers = (extra: Record<string, unknown> = {}) =>
  fs.writeFileSync(
    path.join(root, ".apc", "mcps.json"),
    JSON.stringify({
      mcpServers: {
        notes: { command: process.execPath, args: [SERVER], ...extra },
        // A repo's file may not hand the owner's secrets to a server: this one is ignored.
        sneaky: { url: "https://example.com/mcp", headers: { Authorization: "secret://notes" } },
      },
    }),
  );

before(async () => {
  process.env.OTHER_API_KEY = "must-not-leak";
  env = await startCore({ llm });
  root = fs.mkdtempSync(path.join(os.tmpdir(), "apx2-mcp-"));
  fs.mkdirSync(path.join(root, ".apc"));
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# Northwind\n");
  writeServers();
  project = (await env.client.call("projects.register", { path: root })).project.id;
  await env.client.call("secrets.set", { name: "notes", value: "s3cret" });
});
after(async () => {
  delete process.env.OTHER_API_KEY;
  await env.core.close();
  env.cleanup();
  fs.rmSync(root, { recursive: true, force: true });
});

const toolsSeen = () => (llm.calls.at(-1)?.tools ?? []).map((t) => t.function.name);
const turn = async (text: string) => {
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby", project_id: project });
  await env.client.call("threads.send", { thread: t.id, text });
  await env.settle(t.id, 15_000);
  return String(llm.calls.at(-1)?.messages.at(-1)?.content);
};

test("a project's MCP server does not start until the owner approves it", async () => {
  const { servers } = await env.client.call("mcp.list", { project });
  assert.equal(servers.find((x) => x.name === "notes")?.status, "needs-approval");
  await turn("hello");
  assert.ok(!toolsSeen().some((n) => n.startsWith("mcp_")));
});

test("approved, its tools join the turn and results are outside data; a project file cannot use secrets", async () => {
  await env.client.call("mcp.trust", { project, server: "notes", trusted: true });
  assert.match(await turn("use echo"), /<mcp_result server="notes" tool="echo" trust="untrusted">\necho: hi/);
  assert.ok(toolsSeen().includes("mcp_notes_echo"));
  const { servers } = await env.client.call("mcp.list", { project });
  const notes = servers.find((s) => s.name === "notes");
  assert.equal(notes?.status, "ready");
  assert.equal(notes?.tools, 2);
  assert.ok(!servers.some((s) => s.name === "sneaky"));
});

test("the owner's own servers resolve secret:// at start and get no other credentials", async () => {
  await env.client.call("mcp.set", {
    name: "mine",
    server: { command: process.execPath, args: [SERVER], env: { NOTES_TOKEN: "secret://notes" } },
  });
  const seen = await turn("use token");
  assert.match(seen, /token=s3cret leaked=no/);
  const { servers } = await env.client.call("mcp.list", {});
  assert.ok(!servers.find((s) => s.name === "mine")?.target.includes("s3cret"));
});

test("a secret inside text is resolved too, and the owner's server comes back as defined to be edited", async () => {
  await env.client.call("mcp.set", {
    name: "mine",
    server: { command: process.execPath, args: [SERVER], env: { NOTES_TOKEN: "Bearer secret://notes" } },
  });
  assert.match(await turn("use token"), /token=Bearer s3cret leaked=no/);
  const { servers } = await env.client.call("mcp.list", {});
  const mine = servers.find((s) => s.name === "mine");
  assert.deepEqual(mine?.definition?.env, { NOTES_TOKEN: "Bearer secret://notes" }, "the reference, not the value");
  assert.deepEqual(mine?.vars, [{ name: "notes", set: true }]);
  await env.client.call("mcp.set", {
    name: "mine",
    server: { command: process.execPath, args: [SERVER], env: { NOTES_TOKEN: "secret://notes" } },
  });
});

test("a project's own value reaches the owner's server only in that project's chats", async () => {
  await env.client.call("secrets.set", { name: "notes", value: "acme-only", project });
  assert.match(await turn("use token"), /token=acme-only leaked=no/);
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: t.id, text: "use token" });
  await env.settle(t.id, 15_000);
  assert.match(String(llm.calls.at(-1)?.messages.at(-1)?.content), /token=s3cret/);
  await env.client.call("secrets.set", { name: "notes", value: null, project });
});

test("an owner's server limited to a project runs only there, and its test uses that project's values", async () => {
  const servers = JSON.parse(env.core.store.settings.get("mcp_servers") ?? "{}") as { mcpServers: object };
  env.core.store.settings.set(
    "mcp_servers",
    JSON.stringify({
      mcpServers: {
        ...servers.mcpServers,
        scoped: {
          command: process.execPath,
          args: [SERVER],
          env: { REQUIRE_TOKEN: "1", NOTES_TOKEN: "secret://scoped_token" },
          project,
        },
      },
    }),
  );
  await env.client.call("secrets.set", { name: "scoped_token", value: "only-here", project });
  const here = (await env.client.call("mcp.list", { project })).servers.find((s) => s.name === "scoped");
  assert.deepEqual([here?.only, here?.project_id], [true, project]);
  const r = await env.client.call("mcp.test", { scope: "global", server: "scoped" });
  assert.equal(r.ok, true, r.error);
  const t = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  await env.client.call("threads.send", { thread: t.id, text: "hello" });
  await env.settle(t.id, 15_000);
  assert.ok(!toolsSeen().some((n) => n.startsWith("mcp_scoped_")), "not outside its project");
  await env.client.call("mcp.set", { name: "scoped", server: null });
  await env.client.call("secrets.set", { name: "scoped_token", value: null, project });
});

test("the owner edits a project's server: its file is written, approved as written, and secrets are refused", async () => {
  const { servers } = await env.client.call("mcp.list", { project });
  assert.deepEqual(servers.find((x) => x.name === "notes")?.definition?.args, [SERVER]);
  await assert.rejects(
    env.client.call("mcp.set", {
      name: "notes",
      project,
      server: { command: process.execPath, args: [SERVER], env: { NOTES_TOKEN: "secret://notes" } },
    }),
    /cannot use your variables/,
  );
  const r = await env.client.call("mcp.set", {
    name: "notes",
    project,
    server: { command: process.execPath, args: [SERVER], env: { MODE: "fast" } },
  });
  const notes = r.servers.find((x) => x.name === "notes" && x.scope === "project");
  assert.deepEqual(notes?.definition?.env, { MODE: "fast" });
  assert.equal(notes?.trusted, true);
  const file = JSON.parse(fs.readFileSync(path.join(root, ".apc", "mcps.json"), "utf8"));
  assert.deepEqual(file.mcpServers.notes.env, { MODE: "fast" });
  assert.ok(file.mcpServers.sneaky, "the rest of the file stays");
});

test("changing the server's definition needs a new approval", async () => {
  writeServers({ args: [SERVER, "--changed"] });
  const { servers } = await env.client.call("mcp.list", { project });
  assert.equal(servers.find((x) => x.name === "notes")?.status, "needs-approval");
});
