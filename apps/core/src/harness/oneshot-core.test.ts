import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { realpath } from "../paths.ts";
import { removeDir } from "../testkit/platform.ts";
import { oneshotHarness } from "./oneshot.ts";
import type { TurnIO } from "./types.ts";

for (const id of ["aider", "antigravity"] as const) {
  test(`${id}: threads.send persists successful and failed CLI outcomes and steps`, async () => {
    const folder = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-cli-core-")));
    let mode = "echo";
    const fixture = fileURLToPath(new URL("./fake-oneshot.test-support.mjs", import.meta.url));
    const harness = oneshotHarness(id, { cwd: () => folder, binary: async () => process.execPath });
    const env = await startCore({
      llm: scriptedLlm(() => say("unused")),
      harnesses: {
        [id]: {
          id,
          run: (io: TurnIO) =>
            oneshotHarness(id, {
              cwd: () => folder,
              binary: async () => process.execPath,
              prefixArgs: [fixture, mode],
            }).run(io),
        },
      },
    });
    try {
      assert.equal(harness.id, id);
      await env.client.call("agents.update", { agent: "roby", autonomy: "total" });
      const project = (await env.client.call("projects.register", { path: folder, init: true })).project.id;
      const thread = await env.client.call("threads.create", {
        kind: "code",
        agent_id: "roby",
        project_id: project,
        engine: id,
        write: "auto",
      });
      await env.client.call("threads.send", { thread: thread.id, text: "Return a greeting" });
      let settled = await env.settle(thread.id);
      assert.equal(settled.messages.at(-1)?.model, id);
      assert.match(JSON.stringify(settled.messages.at(-1)), /Return a greeting/);
      let runs = env.core.store.runs.list(thread.id);
      assert.equal(runs[0]?.state, "completed");
      assert.equal(env.core.store.runs.steps(runs[0]?.id ?? "")[0]?.state, "ok");
      mode = "fail";
      await env.client.call("threads.send", { thread: thread.id, text: "Fail now" });
      settled = await env.settle(thread.id);
      runs = env.core.store.runs.list(thread.id);
      assert.equal(runs[0]?.state, "failed");
      assert.ok(!JSON.stringify(settled).includes("secret credential"));
      assert.equal(env.core.store.runs.steps(runs[0]?.id ?? "")[0]?.state, "error");
      mode = "echo";
      const readOnly = await env.client.call("threads.create", {
        kind: "code",
        agent_id: "roby",
        project_id: project,
        engine: id,
        write: "read-only",
      });
      await env.client.call("threads.send", { thread: readOnly.id, text: "Do not run this" });
      await env.settle(readOnly.id);
      const denied = env.core.store.runs.list(readOnly.id)[0];
      assert.equal(denied?.state, "failed");
      assert.equal(env.core.store.runs.steps(denied?.id ?? "").length, 0);
    } finally {
      await env.core.close();
      await env.cleanup();
      await removeDir(folder);
    }
  });
}
