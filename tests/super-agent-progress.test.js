import { test } from "node:test";
import assert from "node:assert/strict";
import { ProjectManager } from "../src/host/daemon/db.js";
import { runSuperAgent } from "../src/host/daemon/super-agent.js";
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
