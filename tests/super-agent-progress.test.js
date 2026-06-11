import { test } from "node:test";
import assert from "node:assert/strict";
import { ProjectManager } from "#host/daemon/db.js";
import { runSuperAgent } from "#core/agent/super-agent.js";
import { makeTempProject, cleanupTempProject } from "./_helpers.js";

test("runSuperAgent emits progress events as tools execute", async () => {
  const root = makeTempProject({ name: "Progress Project" });
  const projects = new ProjectManager({ engines: {} });
  projects.register(root);
  const events = [];

  try {
    const result = await runSuperAgent({
      globalConfig: {
        super_agent: {
          enabled: true,
          model: "mock",
          permission_mode: "total",
        },
      },
      projects,
      plugins: null,
      registries: null,
      prompt: "[mock:tool:list_projects]",
      onEvent: (event) => events.push(event),
    });

    assert.match(result.text, /\[mock:mock\] received/);
    assert.deepEqual(events.map((event) => event.type), [
      "model_start",
      "tool_start",
      "tool_result",
      "model_start",
    ]);
    assert.equal(events[1].trace.tool, "list_projects");
    assert.equal(events[1].trace.pending, true);
    assert.equal(events[2].trace.tool, "list_projects");
    assert.ok(events[2].trace.result[0].name);
  } finally {
    cleanupTempProject(root);
  }
});

test("completionContract: loop keeps going until the model calls finish", async () => {
  const root = makeTempProject({ name: "Contract Project" });
  const projects = new ProjectManager({ engines: {} });
  projects.register(root);
  const events = [];

  try {
    const result = await runSuperAgent({
      globalConfig: {
        super_agent: { enabled: true, model: "mock", permission_mode: "total" },
      },
      projects,
      plugins: null,
      registries: null,
      // First model call → run list_projects; once a tool result exists the
      // mock emits finish("done after tools").
      prompt: "[mock:tool:list_projects][mock:finish:done after tools]",
      channel: "code",
      completionContract: true,
      onEvent: (event) => events.push(event),
    });

    // The finish summary becomes the final text — not the mock's echo.
    assert.equal(result.text, "done after tools");
    const types = events.map((e) => e.type);
    // A real tool ran, then the turn ended via the finish summary.
    assert.deepEqual(types, [
      "model_start",
      "tool_start",
      "tool_result",
      "model_start",
      "assistant_text",
    ]);
    assert.equal(events[1].trace.tool, "list_projects");
    assert.equal(events[4].text, "done after tools");
  } finally {
    cleanupTempProject(root);
  }
});
