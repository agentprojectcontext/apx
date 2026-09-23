// comment_task hands a task on: an agent that mentions another in a comment
// summons them — end to end, through the real turn on the mock engine.
//
// It used to record the mention and summon nobody, while the prompt told every
// agent that "work for another agent is a task — comment on it mentioning
// them". The hand-off landed nowhere until the other agent happened to look.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-comment-summon-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test, afterEach } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");
// comment-turn first: it loads the tool registry, which loads this handler —
// the order production boots in (importing the handler first hits the cycle).
const { _resetTaskTurnCaps } = await import("#core/tasks/comment-turn.js");
const commentTask = (await import("#core/agent/tools/handlers/comment-task.js")).default;
const { createTask, getTask } = await import("#core/stores/tasks.js");

const config = {
  super_agent: { enabled: false, model: "mock:base", model_fallback: { enabled: false }, stuck_detection: { enabled: false } },
  engines: {},
};

let root;
afterEach(() => { _resetTaskTurnCaps(); try { cleanupTempProject(root); } catch { /* gone */ } });

test("an agent's @mention in comment_task gets the other agent's reply on the task", async () => {
  root = makeTempProject({ name: "acme", agents: [{ slug: "qa", description: "QA" }, { slug: "dev", description: "Dev" }] });
  const storagePath = fs.mkdtempSync(path.join(TMP_HOME, "store-"));
  const p = { id: 1, name: "acme", path: root, storagePath, config, logMessage: () => {} };
  const projects = { list: () => [p], get: (id) => (String(id) === "1" ? p : null) };
  const t = createTask(storagePath, { title: "probar el login" });

  const handler = commentTask.makeHandler({ projects, channelMeta: { agentSlug: "dev" }, globalConfig: config });
  const r = await handler({ task: t.id, text: "@qa listo para QA, probalo", project: "1" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.summoned, ["qa"]);
  assert.match(r.note, /Handed on/);

  for (let i = 0; i < 80 && getTask(storagePath, t.id).comments.length < 2; i++) {
    await new Promise((res) => setTimeout(res, 25));
  }
  const by = getTask(storagePath, t.id).comments.map((c) => c.by);
  assert.deepEqual(by, ["dev", "qa"], "qa answered on the task");
});
