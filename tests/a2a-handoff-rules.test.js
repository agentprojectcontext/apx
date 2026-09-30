// How agents hand work to each other, after the 2026-09-30 reel run: a question
// card an a2a thread could never answer, three agents waiting on each other
// behind one render, and "where did it get to?" starting the work over.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-handoff-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test, after } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { createToolSession } = await import("#core/agent/tools/registry.js");
const { openJob, readJob } = await import("#core/stores/background-jobs.js");
const { default: callAgent } = await import("#core/agent/tools/handlers/call-agent.js");
const { default: sendToAgent } = await import("#core/agent/tools/handlers/send-to-agent.js");
const { default: checkJobs } = await import("#core/agent/tools/handlers/check-jobs.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

const root = makeTempProject({ name: "northwind", agents: [{ slug: "lead" }, { slug: "editor" }] });
const project = { id: 4, path: root, name: "northwind", storagePath: path.join(TMP_HOME, "store"), config: {}, logMessage: () => {} };
const projects = { get: () => project, list: () => [{ id: 4, path: root }] };
after(() => { cleanupTempProject(root); fs.rmSync(TMP_HOME, { recursive: true, force: true }); });

test("an a2a turn cannot ask a question card", () => {
  const names = (ch) => createToolSession(ch).initialSchemas.map((s) => s.function?.name || s.name);
  assert.ok(!names("a2a").includes("ask_questions"));
  assert.deepEqual(createToolSession("a2a").activate({ names: ["ask_questions"] }).denied, ["ask_questions"]);
  assert.ok(names("web").includes("ask_questions"), "the owner's own chats keep it");
});

test("asking again while the first hand-off runs returns its status, not a new turn", async () => {
  const job = openJob({ project_id: 4, from: "super_agent", to: "lead", thread: "lead~super_agent", body: "Producí el reel 25", wake: true });
  const call = callAgent.makeHandler({ projects, channel: "web", channelMeta: {} });
  const r = await call({ project: "4", agent: "lead", prompt: "¿dónde quedó el reel?" });
  assert.equal(r.already_running.job_id, job.id);
  assert.match(r.already_running.what, /reel 25/);
  const send = sendToAgent.makeHandler({ projects, channel: "telegram", channelMeta: {} });
  assert.equal((await send({ project: "4", to: "lead", message: "¿y?" })).already_running.job_id, job.id);
  const status = checkJobs.makeHandler({ channelMeta: {} })({});
  assert.equal(status.open, 1);
  assert.equal(status.jobs[0].agent, "lead");
});

test("from inside an a2a turn, handing work on never waits", async () => {
  // lead, answering in an a2a thread, hands the production to editor.
  const call = callAgent.makeHandler({ projects, channel: "a2a", channelMeta: { agentSlug: "lead", a2aDepth: 1 } });
  const r = await call({ project: "4", agent: "editor", prompt: "Renderizá el reel 25" });
  assert.ok(r.job_id, `left running, not waited on: ${JSON.stringify(r)}`);
  assert.match(r.note, /background/);
  assert.equal(readJob(r.job_id).from, "lead");
});
