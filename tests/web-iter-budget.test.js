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
  superAgentToolIters,
  WEB_TOOL_ITERS,
  TELEGRAM_TOOL_ITERS,
  MAX_TOOL_ITERS,
} = await import("#core/agent/constants.js");
const { CHANNELS } = await import("#core/constants/channels.js");
const { runSuperAgent } = await import("#core/agent/super-agent.js");
const { ProjectManager } = await import("#host/daemon/db.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

test("superAgentToolIters — the web chat and its sidebar run to completion", () => {
  assert.equal(superAgentToolIters({}, CHANNELS.WEB), WEB_TOOL_ITERS);
  assert.equal(superAgentToolIters({}, CHANNELS.WEB_SIDEBAR), WEB_TOOL_ITERS);
  assert.ok(WEB_TOOL_ITERS > TELEGRAM_TOOL_ITERS && WEB_TOOL_ITERS > MAX_TOOL_ITERS);
});

test("superAgentToolIters — every other channel keeps its own budget", () => {
  // Telegram resolves at its own call site, routines at theirs, and the coding
  // surfaces pass an explicit budget alongside the completion contract. None of
  // them should be pulled onto the web ceiling by accident.
  for (const ch of [CHANNELS.TELEGRAM, CHANNELS.API, CHANNELS.CODE, CHANNELS.WEB_CODE, CHANNELS.DECK, CHANNELS.ROUTINE]) {
    assert.equal(superAgentToolIters({}, ch), null, `${ch} must keep its own budget`);
  }
});

test("superAgentToolIters — config overrides the ceiling, 0/invalid falls back", () => {
  assert.equal(superAgentToolIters({ super_agent: { web_max_iters: 12 } }, CHANNELS.WEB), 12);
  assert.equal(superAgentToolIters({ super_agent: { web_max_iters: 0 } }, CHANNELS.WEB), WEB_TOOL_ITERS);
  assert.equal(superAgentToolIters({ super_agent: { web_max_iters: -3 } }, CHANNELS.WEB), WEB_TOOL_ITERS);
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
  try {
    // web_max_iters keeps the test cheap; WEB_TOOL_ITERS itself is 1000, which
    // is the runaway backstop, not something a test should sit through.
    const webEvents = [];
    await runSuperAgent({
      ...base,
      globalConfig: {
        super_agent: { enabled: true, model: "mock", permission_mode: "total", web_max_iters: 5 },
        memory: { enabled: false },
        engines: {},
      },
      channel: CHANNELS.WEB,
      onEvent: (e) => webEvents.push(e),
    });
    assert.equal(toolResults(webEvents), 4, "the web budget, not runAgent's conversational default");

    const pinned = [];
    await runSuperAgent({
      ...base,
      globalConfig: {
        super_agent: { enabled: true, model: "mock", permission_mode: "total", web_max_iters: 5 },
        memory: { enabled: false },
        engines: {},
      },
      channel: CHANNELS.WEB,
      maxIters: 3,
      onEvent: (e) => pinned.push(e),
    });
    assert.equal(toolResults(pinned), 2, "an explicit caller budget still wins");
  } finally {
    cleanupTempProject(root);
  }
});
