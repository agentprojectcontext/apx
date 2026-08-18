// What a web chat turn leaves behind, so it can be found and read again.
//
// Two regressions, both reported from the panel: a chat started inside a
// project could not be found from that project afterwards, and reopening one
// showed the answer with every tool call erased. Both come from the same write
// path — logWebTurn recorded a user line and a reply line, nothing else:
//
//   - no project on the row, and the ledger is one file per channel+day for the
//     whole daemon, so the sidebar had nothing to scope by;
//   - no tool rows, so the reader had nothing to rebuild the steps from
//     (readGlobalThread has always understood them — the Telegram path writes
//     them and its threads render fine).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The ledger lives under ~/.apx/messages — point HOME somewhere disposable
// BEFORE the modules resolve their paths at import time.
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-web-turn-home-"));
process.env.HOME = TMP_HOME;
process.env.USERPROFILE = TMP_HOME;

const express = (await import("express")).default;
const { register } = await import("#host/daemon/api/super-agent.js");
const { readGlobalThread, listGlobalThreads } = await import("#core/stores/messages.js");
const { apiRouter, makeTempProject, cleanupTempProject } = await import("./_helpers.js");

const TODAY = new Date().toISOString().slice(0, 10);

/** The chat route, mounted over a single project, answering on the mock engine. */
async function serveChat(root) {
  const app = express();
  app.use(express.json());
  const p = { id: 8, name: "postbeam", path: root, storagePath: path.join(TMP_HOME, ".apx", "projects", "8"), config: null };
  register(apiRouter(express, app), {
    projects: { list: () => [p], get: () => p, rebuild: () => {} },
    registries: null,
    plugins: { get: () => null },
    project: () => p,
    config: {
      super_agent: { enabled: true, name: "apx", model: "mock:test", permission_mode: "total" },
      engines: {},
    },
  });
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

test("a web turn is stamped with its project and keeps its tool calls", async () => {
  const root = makeTempProject({ name: "postbeam" });
  const { server, url } = await serveChat(root);
  try {
    const res = await fetch(`${url}/api/projects/8/super-agent/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // The mock engine calls the named tool, then answers on the next pass.
      body: JSON.stringify({ prompt: "listá los proyectos [mock:tool:list_projects]", channel: "web", confirm: false }),
    });
    assert.equal(res.status, 200);
    await res.json();

    // Scoped: the project that hosted the chat finds it.
    const mine = listGlobalThreads({ project: "8" });
    assert.ok(mine.some((t) => t.channel === "web" && t.id === TODAY), "the chat must be listed under its own project");
    // And a different project does not.
    assert.equal(
      listGlobalThreads({ project: "99" }).some((t) => t.channel === "web" && t.id === TODAY),
      false,
      "another project must not inherit it",
    );

    const thread = readGlobalThread({ channel: "web", date: TODAY, project: "8" });
    assert.ok(thread, "the thread must be readable back");

    const user = thread.messages.find((m) => m.role === "user");
    assert.ok(user, "the prompt is part of the record");

    const tool = thread.messages.find((m) => m.role === "tool");
    assert.ok(tool, "reopening the chat must still show what the agent did");
    assert.equal(tool.tool, "list_projects");

    const assistant = thread.messages.find((m) => m.role === "assistant");
    assert.ok(assistant, "the answer is part of the record");
    assert.ok(assistant.tool_summary, "the compact summary rides on the answer row");
    assert.ok(assistant.tool_summary.total >= 1);
  } finally {
    await new Promise((r) => server.close(r));
    cleanupTempProject(root);
  }
});
