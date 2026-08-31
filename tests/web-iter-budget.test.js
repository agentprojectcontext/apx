// The web chat is the surface you WATCH — it runs to completion instead of
// stopping every ~9 actions to ask "want me to keep going?". That close is
// Telegram's guardrail (you can't see a phone turn go wrong); on web it was
// pure friction, and worse, the judge used to re-run the turn behind it and
// send the same recap and the same question two more times.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-webiters-home-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx"); // isolate the apx home too — HOME alone is overridden by the runner's APX_HOME

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const {
  channelToolIters,
  WEB_TOOL_ITERS,
  TELEGRAM_TOOL_ITERS,
  MAX_TOOL_ITERS,
} = await import("#core/agent/constants.js");
const { CHANNELS } = await import("#core/constants/channels.js");
const { runSuperAgent } = await import("#core/agent/super-agent.js");
const { ProjectManager } = await import("#host/daemon/db.js");
const { makeTempProject, cleanupTempProject, apiRouter } = await import("./_helpers.js");
const { default: express } = await import("express");
const { register: registerExec } = await import("../src/host/daemon/api/exec.js");

test("channelToolIters — the web chat and its sidebar run to completion", () => {
  assert.equal(channelToolIters({}, CHANNELS.WEB), WEB_TOOL_ITERS);
  assert.equal(channelToolIters({}, CHANNELS.WEB_SIDEBAR), WEB_TOOL_ITERS);
  assert.ok(WEB_TOOL_ITERS > TELEGRAM_TOOL_ITERS && WEB_TOOL_ITERS > MAX_TOOL_ITERS);
});

test("channelToolIters — every other channel keeps its own budget", () => {
  // Telegram resolves at its own call site, routines at theirs, and the coding
  // surfaces pass an explicit budget alongside the completion contract. None of
  // them should be pulled onto the web ceiling by accident.
  for (const ch of [CHANNELS.TELEGRAM, CHANNELS.API, CHANNELS.CODE, CHANNELS.WEB_CODE, CHANNELS.DECK, CHANNELS.ROUTINE]) {
    assert.equal(channelToolIters({}, ch), null, `${ch} must keep its own budget`);
  }
});

test("channelToolIters — config overrides the ceiling, 0/invalid falls back", () => {
  assert.equal(channelToolIters({ super_agent: { web_max_iters: 12 } }, CHANNELS.WEB), 12);
  assert.equal(channelToolIters({ super_agent: { web_max_iters: 0 } }, CHANNELS.WEB), WEB_TOOL_ITERS);
  assert.equal(channelToolIters({ super_agent: { web_max_iters: -3 } }, CHANNELS.WEB), WEB_TOOL_ITERS);
});

test("runSuperAgent: the web budget reaches the loop (and an explicit maxIters still wins)", async () => {
  const root = makeTempProject({ name: "Web Iters" });
  const projects = new ProjectManager({ engines: {} });
  projects.register(root);
  const base = {
    projects,
    plugins: null,
    registries: null,
    // Never stops on its own: it re-fires the tool every step it is offered, so
    // the run ends exactly at the budget and the tool_result count IS the budget
    // minus the reserved wrap-up step.
    prompt: "[mock:loop:list_projects]",
  };
  const toolResults = (events) => events.filter((e) => e.type === "tool_result").length;
  // web_max_iters keeps the test cheap; WEB_TOOL_ITERS itself is 1000, which is
  // the runaway backstop, not something a test should sit through. Stuck
  // detection is off because a mock that re-fires ONE tool is its textbook
  // trigger — it would abort at 4 and we'd be measuring the detector, not the
  // budget.
  const cfg = (extra = {}) => ({
    super_agent: {
      enabled: true, model: "mock", permission_mode: "total",
      web_max_iters: 7, stuck_detection: { enabled: false }, ...extra,
    },
    memory: { enabled: false },
    engines: {},
  });
  try {
    const webEvents = [];
    await runSuperAgent({ ...base, globalConfig: cfg(), channel: CHANNELS.WEB, onEvent: (e) => webEvents.push(e) });
    assert.equal(toolResults(webEvents), 6, "the web budget, not runAgent's conversational default");

    const apiEvents = [];
    await runSuperAgent({ ...base, globalConfig: cfg(), channel: CHANNELS.API, onEvent: (e) => apiEvents.push(e) });
    assert.equal(toolResults(apiEvents), MAX_TOOL_ITERS - 1, "every other channel is untouched");

    const pinned = [];
    await runSuperAgent({ ...base, globalConfig: cfg(), channel: CHANNELS.WEB, maxIters: 3, onEvent: (e) => pinned.push(e) });
    assert.equal(toolResults(pinned), 2, "an explicit caller budget still wins");
  } finally {
    cleanupTempProject(root);
  }
});

// The same wall, on a project agent: Magui in the web chat stopped after 9
// actions and asked "¿seguimos?", turn after turn (2026-08-31). The budget
// belongs to the SURFACE — a watched chat is a watched chat whether Roby or a
// project agent is answering — but only runSuperAgent had been taught that, so
// every non-super-agent kept runAgent's conversational default of 10.
test("project agents on web get the surface budget too, not the chat default", async () => {
  const root = fs.mkdtempSync(path.join(TMP_HOME, "proj-"));
  const storage = fs.mkdtempSync(path.join(TMP_HOME, "store-"));
  fs.mkdirSync(path.join(root, ".apc", "agents"), { recursive: true });
  fs.writeFileSync(path.join(root, ".apc", "project.json"), JSON.stringify({ name: "tmp", apx: "installed" }));
  fs.writeFileSync(
    path.join(root, ".apc", "agents", "magui.md"),
    ["---", "Role: Tester", "Model: mock", "---", "", "You are a test agent."].join("\n"),
  );
  const PROJECT = { id: "1", name: "tmp", path: root, storagePath: storage, logMessage: () => {} };

  const app = express();
  app.use(express.json());
  registerExec(apiRouter(express, app), {
    projects: { list: () => [PROJECT], get: () => PROJECT, rebuild: () => {} },
    project: () => PROJECT,
    // web_max_iters keeps the test cheap (the shipped ceiling is 1000), and
    // stuck detection is off — a mock re-firing one tool is its trigger, and it
    // would abort the loop before the budget ever ran out.
    config: {
      model: "mock", engines: {},
      super_agent: { web_max_iters: 7, stuck_detection: { enabled: false } },
    },
    plugins: {},
    registries: null,
  });
  const server = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  const call = async (body) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/projects/1/agents/magui/exec`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  };
  try {
    // Re-fires the tool every step it is offered, so the trace length IS the
    // budget minus the step reserved for the wrap-up.
    const onWeb = await call({ prompt: "[mock:loop:list_agents]", model: "mock", channel: CHANNELS.WEB });
    assert.equal(onWeb.trace.length, 6, "the web budget reached the project-agent loop");

    // An unwatched surface keeps the bounded conversational default: 10 iters,
    // the last reserved for the wrap-up.
    const onApi = await call({ prompt: "[mock:loop:list_agents]", model: "mock", channel: CHANNELS.API });
    assert.equal(onApi.trace.length, MAX_TOOL_ITERS - 1, "every other channel is untouched");

    const pinned = await call({ prompt: "[mock:loop:list_agents]", model: "mock", channel: CHANNELS.WEB, maxIters: 3 });
    assert.equal(pinned.trace.length, 2, "an explicit caller budget still wins");
  } finally {
    server.close();
  }
});
