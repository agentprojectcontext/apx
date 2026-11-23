// Which models run, APX's voice, local transcription and an MCP server's tools, changed by the super-agent at the
// owner's word: in Auto with no card, each checked before it is written (DECISIONS.md#d-266).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { tempDir } from "../testkit/platform.ts";
import { settingsCore } from "./settings.test-support.ts";

const SERVER = path.join(import.meta.dirname, "..", "mcp", "fake-server.test-support.mjs");
let h: Awaited<ReturnType<typeof settingsCore>>;
let dir: ReturnType<typeof tempDir>;
before(async () => {
  h = await settingsCore();
  dir = tempDir("apx-models-");
});
after(async () => {
  await h.env.core.close();
  await h.env.cleanup();
  await dir.remove();
});

const pending = async () => (await h.env.client.call("runs.pending", {})).inputs.length;
const config = () => h.env.client.call("models.config", {});

test("models: the router changes in Auto with no card; an engine not connected or an empty chain changes nothing", async () => {
  const before = await config();
  const off = { method: "models.set_config", params: { router: { chain: ["northwind/model-1"] } } };
  assert.match((await h.ask(off)).answer, /northwind|unknown engine/);
  const empty = { method: "models.set_config", params: { router: { chain: [] } } };
  assert.match((await h.ask(empty)).answer, /needs at least one model/);
  await h.env.client.call("providers.set", {
    id: "acme-llm",
    provider: { transport: "openai-chat", base_url: "https://llm.example.com/v1", needs_key: true },
  });
  const keyless = { method: "models.set_config", params: { router: { chain: ["acme-llm/model-1"] } } };
  assert.match((await h.ask(keyless)).answer, /^not saved: acme-llm is off or without a key here/);
  assert.deepEqual(await config(), before);
  const ok = { method: "models.set_config", params: { router: { chain: ["fake/fake-2", "fake/fake-1"] } } };
  assert.match((await h.ask(ok)).answer, /^saved: .*router chain fake\/fake-2 → fake\/fake-1$/);
  assert.equal(await pending(), 0);
  assert.deepEqual((await config()).router, { rules: before.router.rules, chain: ["fake/fake-2", "fake/fake-1"] });
});

test("models: one chat's model changes in Auto, and a model of an engine not connected is refused", async () => {
  const chat = await h.env.client.call("threads.create", { kind: "loose", agent_id: "superagent", title: "Acme" });
  const set = {
    method: "threads.model",
    params: { thread: chat.id, model_choice: { model: "fake/fake-2", router: false } },
  };
  assert.match((await h.ask(set)).answer, /^saved: the chat runs on fake\/fake-2$/);
  const bad = {
    method: "threads.model",
    params: { thread: chat.id, model_choice: { model: "northwind/x", router: false } },
  };
  assert.match((await h.ask(bad)).answer, /northwind|unknown engine/);
  assert.equal(await pending(), 0);
});

test("voice and transcription: a service that is not there and a model off the list are refused before writing", async () => {
  const voice = { method: "voice.set", params: { call_speech: "acme-speech" } };
  assert.match((await h.ask(voice)).answer, /no service acme-speech/);
  const whisper = { method: "transcription.install", params: { model: "acme-whisper" } };
  assert.match((await h.ask(whisper)).answer, /pick one of base, small, large-v3-turbo-q5_0/);
  assert.match((await h.ask({ method: "transcription.local" })).answer, /^models: base .*\nfits this computer: /);
});

test("MCP: running a project's server keeps the owner's card even in Total; its tools are approved in Auto", async () => {
  fs.mkdirSync(path.join(dir.path, ".apc"));
  fs.writeFileSync(
    path.join(dir.path, ".apc", "mcps.json"),
    JSON.stringify({ mcpServers: { notes: { command: process.execPath, args: [SERVER] } } }),
  );
  const project = (await h.env.client.call("projects.register", { path: dir.path })).project.id;
  const trust = { method: "mcp.trust", params: { project, server: "notes", trusted: true } };
  await h.inMode("total", async () => {
    assert.match((await h.ask(trust, "deny")).detail, /^Run the MCP server notes from the project's file/);
  });
  await h.env.client.call("mcp.trust", { project, server: "notes", trusted: true });
  const approve = { method: "mcp.approveTool", params: { scope: "project", server: "notes", project, tool: "echo" } };
  assert.match((await h.ask(approve)).answer, /^done/);
  assert.equal(await pending(), 0);
  const approvals = (await h.env.client.call("tools.approvals", {})).approvals;
  assert.ok(approvals.some((g) => g.tool === "echo" && g.scope === "always"));
});
