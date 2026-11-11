import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { mock, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { samePath } from "../paths.ts";
import { tempDir } from "../testkit/platform.ts";

test("review application revalidates after staging bytes and preserves an editor's intervening save", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const dir = tempDir("apx-agent-review-race-");
  try {
    const project = (await env.client.call("projects.register", { path: dir.path, init: true })).project;
    const agent = await env.client.call("agents.create", {
      project_id: project.id,
      slug: "writer",
      name: "Writer",
      prompt: "Original instructions",
    });
    const before = await env.client.call("agents.get", { agent: agent.id });
    const file = path.join(dir.path, ".apc", "agents", "writer.md");
    const original = fs.readFileSync(file, "utf8");
    const write = fs.writeFileSync;
    let intervened = false;
    const intercepted = mock.method(
      fs,
      "writeFileSync",
      (
        target: fs.PathOrFileDescriptor,
        data: Parameters<typeof fs.writeFileSync>[1],
        options?: Parameters<typeof fs.writeFileSync>[2],
      ) => {
        write(target, data, options);
        if (
          !intervened &&
          typeof target === "string" &&
          samePath(path.dirname(target), path.dirname(file)) &&
          path.extname(target) === ".tmp"
        ) {
          intervened = true;
          write(file, original.replace("Original instructions", "Saved by an external editor"));
        }
      },
    );
    try {
      await assert.rejects(
        env.client.call("agents.update", {
          agent: agent.id,
          prompt: "Reviewed replacement",
          if_revision: before.revision,
        }),
        /changed since this review/,
      );
    } finally {
      intercepted.mock.restore();
    }
    assert.equal(intervened, true, "the external save happens after the initial revision check and temp write");
    assert.match(fs.readFileSync(file, "utf8"), /Saved by an external editor/);
    assert.equal(fs.readdirSync(path.dirname(file)).filter((name) => path.extname(name) === ".tmp").length, 0);
    const latest = await env.client.call("agents.get", { agent: agent.id });
    assert.equal(latest.prompt, "Saved by an external editor");
    await env.client.call("agents.update", {
      agent: agent.id,
      prompt: "Reviewed latest instructions",
      if_revision: latest.revision,
    });
    assert.match(fs.readFileSync(file, "utf8"), /Reviewed latest instructions/);
  } finally {
    await env.core.close();
    await env.cleanup();
    await dir.remove();
  }
});
