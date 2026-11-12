// A routine's run has the tools its agent has when the owner talks to it in that project, and acts as the owner chose
// on the routine (DECISIONS.md#d-223).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import type { Message, Routine } from "@apx/protocol";
import { type TempDir, tempDir } from "../testkit/platform.ts";
import { callTool, inputOrEnd, say, scriptedLlm, startCore } from "./testkit.ts";

const SERVER = path.join(import.meta.dirname, "../mcp/fake-server.test-support.mjs");

const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(`Result: ${String(req.messages.at(-1)?.content).slice(0, 300)}`);
  if (said.includes("use echo")) return callTool("e1", "mcp_call", { tool: "mcp_notes_echo", args: { text: "hi" } });
  const file = /write (\S+)/.exec(said)?.[1];
  if (file) return callTool("w1", "file_write", { path: path.join(root, file), content: "routine\n" });
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
let folder: TempDir;
let root = "";
let project = "";

before(async () => {
  env = await startCore({ llm });
  folder = tempDir("apx-routine-tools-");
  root = folder.path;
  fs.mkdirSync(path.join(root, ".apc"));
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# Northwind\n");
  fs.writeFileSync(
    path.join(root, ".apc", "mcps.json"),
    JSON.stringify({ mcpServers: { notes: { command: process.execPath, args: [SERVER] } } }),
  );
  project = (await env.client.call("projects.register", { path: root })).project.id;
  await env.client.call("mcp.trust", { project, server: "notes", trusted: true });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  await folder.remove();
});

const routine = (agent: string, prompt: string, extra: Partial<Parameters<typeof set>[0]> = {}) =>
  set({ name: `Check ${prompt}`, agent, schedule: { kind: "manual" }, prompt, enabled: true, ...extra });
const set = (p: {
  name: string;
  agent: string;
  project?: string;
  schedule: Routine["schedule"];
  prompt: string;
  enabled: boolean;
  autonomy?: "manual" | "auto" | "total" | null;
  id?: string;
}) => env.client.call("routines.set", p);

const toolParts = (messages: Message[]) =>
  messages.flatMap((m) => m.parts.flatMap((p) => (p.type === "tool" ? [p] : [])));

/** Runs a routine now and returns what its run did, or the card it waits on. */
async function runOf(id: string) {
  const run = await env.client.call("routines.run", { routine: id });
  const input = await inputOrEnd(env.client, run.thread_id, 20_000);
  if (input) return { thread: run.thread_id, input, tools: [] };
  const { messages } = await env.settle(run.thread_id, 20_000);
  return { thread: run.thread_id, input, tools: toolParts(messages) };
}

test("a routine of an agent the owner talks to in a project runs that project's MCP tool, as the chat does", async () => {
  const agent = await env.client.call("agents.create", { slug: "helper", name: "Helper" });
  // In the project's chat the agent reaches the project's MCP server.
  const chat = await env.client.call("threads.create", { kind: "loose", agent_id: agent.id, project_id: project });
  await env.client.call("threads.send", { thread: chat.id, text: "use echo" });
  const inChat = toolParts((await env.settle(chat.id, 20_000)).messages);
  assert.deepEqual(
    inChat.map((p) => [p.tool, p.status]),
    [["mcp_notes_echo", "ok"]],
  );
  // Its routine in that project does too.
  const here = await routine(agent.id, "use echo", { project });
  const ran = await runOf(here.id);
  assert.deepEqual(
    ran.tools.map((p) => [p.tool, p.status]),
    [["mcp_notes_echo", "ok"]],
  );
  assert.match(String(ran.tools[0]?.detail), /echo: hi/);
  // Saved with no project it runs in none: the project's servers are not there, which is why the editor asks where.
  const nowhere = await routine(agent.id, "use echo");
  assert.equal(nowhere.project_id, undefined);
  assert.deepEqual(
    (await runOf(nowhere.id)).tools.map((p) => [p.tool, p.status]),
    [["mcp_notes_echo", "error"]],
  );
});

test("a project agent's routine saved without a project runs in the agent's project, with its MCP tools", async () => {
  const agent = await env.client.call("agents.create", { slug: "keeper", name: "Keeper", project_id: project });
  const r = await routine(agent.id, "use echo");
  assert.equal(r.project_id, project);
  const ran = await runOf(r.id);
  assert.deepEqual(
    ran.tools.map((p) => [p.tool, p.status]),
    [["mcp_notes_echo", "ok"]],
  );
});

test("a routine on Total runs what its agent would ask for, only in its own runs and with no grant left", async () => {
  const agent = await env.client.call("agents.create", { slug: "careful", name: "Careful", project_id: project });
  await env.client.call("agents.update", { agent: agent.id, autonomy: "manual" });
  // The agent's own mode: a change waits for the owner.
  const asks = await routine(agent.id, "write asks.md");
  assert.equal(asks.autonomy, undefined);
  const card = await runOf(asks.id);
  assert.equal(card.input?.tool, "file_write");
  await env.client.call("runs.respond", { input: card.input?.id ?? "", decision: "deny" });
  await env.settle(card.thread, 20_000);
  // The same routine on Total writes with no card.
  const again = { id: asks.id, name: asks.name, agent: agent.id, schedule: asks.schedule, prompt: asks.prompt };
  const total = await set({ ...again, enabled: true, autonomy: "total" });
  assert.equal(total.autonomy, "total");
  const ran = await runOf(total.id);
  assert.equal(ran.input, undefined);
  assert.deepEqual(
    ran.tools.map((p) => [p.tool, p.status]),
    [["file_write", "ok"]],
  );
  assert.equal(fs.readFileSync(path.join(root, "asks.md"), "utf8"), "routine\n");
  // Nothing became a grant: the agent's own chat still asks.
  assert.deepEqual((await env.client.call("tools.approvals", {})).approvals, []);
  const chat = await env.client.call("threads.create", { kind: "loose", agent_id: agent.id, project_id: project });
  await env.client.call("threads.send", { thread: chat.id, text: "write chat.md" });
  const asked = await inputOrEnd(env.client, chat.id, 20_000);
  assert.equal(asked?.tool, "file_write");
  await env.client.call("runs.respond", { input: asked?.id ?? "", decision: "deny" });
  await env.settle(chat.id, 20_000);
  // Back to the agent's own mode: null.
  assert.equal((await set({ ...again, enabled: true, autonomy: null })).autonomy, undefined);
});

test("a routine on Ask stops before a change its agent on Auto would make alone", async () => {
  const agent = await env.client.call("agents.create", { slug: "bold", name: "Bold", project_id: project });
  const r = await routine(agent.id, "write bold.md", { autonomy: "manual" });
  const ran = await runOf(r.id);
  assert.equal(ran.input?.tool, "file_write");
  await env.client.call("runs.respond", { input: ran.input?.id ?? "", decision: "deny" });
  await env.settle(ran.thread, 20_000);
  assert.equal(fs.existsSync(path.join(root, "bold.md")), false);
});
