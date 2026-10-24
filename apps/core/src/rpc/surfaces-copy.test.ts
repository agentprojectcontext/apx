import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { removeDir } from "../testkit/platform.ts";

test("a widget is copied into another project as the owner's, never over one there by its name", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apx-surface-copy-"));
  try {
    fs.writeFileSync(path.join(root, "AGENTS.md"), "# Northwind\n");
    const { project } = await env.client.call("projects.register", { path: root });
    const original = await env.client.call("surfaces.show", { name: "sales", title: "Sales", html: "<h1>100</h1>" });
    const copy = await env.client.call("surfaces.copy", { surface: original.id, project_id: project.id, pinned: true });
    assert.notEqual(copy.id, original.id);
    assert.equal(copy.project_id, project.id);
    assert.equal(copy.name, "sales");
    assert.equal(copy.pinned, true);
    assert.equal(copy.created_by, "owner");
    assert.equal((await env.client.call("surfaces.get", { surface: copy.id })).html, "<h1>100</h1>");
    // Copied again, it takes a numbered name; the first copy stays as it was.
    const again = await env.client.call("surfaces.copy", { surface: original.id, project_id: project.id });
    assert.equal(again.name, "sales-2");
    assert.equal((await env.client.call("surfaces.get", { surface: copy.id })).version, copy.version);
    // And back into the base project, which already has "sales".
    assert.equal((await env.client.call("surfaces.copy", { surface: copy.id, project_id: null })).name, "sales-2");
  } finally {
    await env.core.close();
    await env.cleanup();
    await removeDir(root);
  }
});
