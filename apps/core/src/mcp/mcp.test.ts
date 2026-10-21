import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { scratchRoot } from "../tools/folders.ts";

const SERVER = path.join(import.meta.dirname, "fake-server.test-support.mjs");

const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(`Result: ${String(req.messages.at(-1)?.content).slice(0, 300)}`);
  if (said.includes("bridge shell"))
    return callTool("x1", "mcp_call", { tool: "shell", args: { command: "echo pwned" } });
  if (said.includes("find echo")) return callTool("s1", "mcp_search", { query: "echo text back" });
  if (said.includes("use echo")) return callTool("e1", "mcp_call", { tool: "mcp_notes_echo", args: { text: "hi" } });
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
  root = fs.mkdtempSync(path.join(os.tmpdir(), "apx-mcp-"));
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

test("approved, its tools are found and run through two tools; results are outside data; a project file cannot use secrets", async () => {
  await env.client.call("mcp.trust", { project, server: "notes", trusted: true });
  // A turn that uses no MCP tool starts no server, and the model sees two tools, not one per MCP tool.
  await turn("hello");
  assert.equal((await env.client.call("mcp.list", { project })).servers.find((s) => s.name === "notes")?.status, "off");
  assert.deepEqual(
    toolsSeen().filter((n) => n.startsWith("mcp_")),
    ["mcp_search", "mcp_call"],
  );
  assert.match(
    llm.calls.at(-1)?.tools.find((t) => t.function.name === "mcp_search")?.function.description ?? "",
    /notes/,
  );
  const found = await turn("find echo");
  assert.match(found, /## mcp_notes_echo\n\[notes\]/);
  assert.match(found, /args: \{.*"text"/);
  assert.match(await turn("use echo"), /<mcp_result server="notes" tool="echo" trust="untrusted">\necho: hi/);
  // The bridge runs MCP tools only: an APX tool keeps to its own name and its own checks.
  assert.match(await turn("bridge shell"), /unknown tool shell; mcp_call runs a tool mcp_search found/);
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
  // Not the core's folder: a server saving under a relative path (a screenshot) must not fill a checkout.
  const cwd = seen.match(/cwd=(\S+)/)?.[1] ?? "";
  assert.ok(cwd.startsWith(fs.realpathSync(scratchRoot(env.home))), cwd);
  assert.notEqual(cwd, fs.realpathSync(process.cwd()));
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

test("terminal MCP calls describe schemas, validate arguments and preserve raw results", async () => {
  const target = { scope: "global" as const, server: "mine" };
  const { tools } = await env.client.call("mcp.describe", target);
  assert.ok(tools.find((t) => t.name === "echo")?.inputSchema.properties);
  const r = await env.client.call("mcp.call", { ...target, tool: "echo", arguments: { text: "terminal" } });
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const cli = path.resolve(import.meta.dirname, "../../../terminal/src/main.ts");
  const run = promisify(execFile);
  const listed = await run(process.execPath, [cli, "mcp", "tools", "mine", "--json"], {
    env: { ...process.env, APX_URL: env.core.url },
  });
  assert.ok(JSON.parse(listed.stdout).tools.some((t: { name: string }) => t.name === "echo"));
  const called = await run(process.execPath, [cli, "mcp", "run", "mine", "echo", '{"text":"cli"}'], {
    env: { ...process.env, APX_URL: env.core.url },
  });
  assert.equal(JSON.parse(called.stdout).content[0].text, "echo: cli");
  assert.equal(r.content?.[0]?.text, "echo: terminal");
  await assert.rejects(
    env.client.call("mcp.call", { ...target, tool: "echo", arguments: { text: 12 } }),
    /invalid|expected/i,
  );
  await assert.rejects(env.client.call("mcp.call", { ...target, tool: "missing", arguments: {} }), /not found/);
});

test("direct MCP calls obey project toggles and cannot be made by an agent", async () => {
  const target = { scope: "global" as const, server: "mine", project };
  await env.client.call("mcp.toggle", { project, server: "mine", on: false });
  try {
    await assert.rejects(
      env.client.call("mcp.call", { ...target, tool: "echo", arguments: { text: "blocked" } }),
      /not enabled/,
    );
    await assert.rejects(env.client.call("mcp.describe", target), /not enabled/);
  } finally {
    await env.client.call("mcp.toggle", { project, server: "mine", on: true });
  }
  const { ApxClient } = await import("@apx/protocol/client");
  const agent = new ApxClient({ url: env.core.url, actor: "agent" });
  await assert.rejects(agent.call("mcp.call", { ...target, tool: "echo", arguments: { text: "blocked" } }), /reserved/);
});

test("a project's mcps.json saved with a BOM is read, and editing it keeps the file's other servers", async () => {
  const file = path.join(root, ".apc", "mcps.json");
  fs.writeFileSync(file, `\uFEFF${fs.readFileSync(file, "utf8")}`);
  const { servers } = await env.client.call("mcp.list", { project });
  assert.ok(servers.some((x) => x.name === "notes" && x.scope === "project"));
  await env.client.call("mcp.set", {
    name: "notes",
    project,
    server: { command: process.execPath, args: [SERVER], env: { MODE: "slow" } },
  });
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(doc.mcpServers.notes.env, { MODE: "slow" });
  assert.ok(doc.mcpServers.sneaky, "the rest of the file stays");
});
