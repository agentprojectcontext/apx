import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ApxError } from "@apx/protocol/client";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

function makeProject(root: string) {
  fs.mkdirSync(path.join(root, ".apc", "agents"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".apc", "project.json"),
    JSON.stringify({ name: "Northwind", description: "A sample company", apx_id: "abc123def456", kind: "company" }),
  );
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# Northwind\nUse metric units.\n");
  fs.writeFileSync(
    path.join(root, ".apc", "agents", "arch.md"),
    "---\nname: Arch\nrole: Software Architect\nmodel: gemini:gemini-pro\nparent: ceo\nicon: saturno\n---\n\nKeep it simple.\n",
  );
  fs.writeFileSync(
    path.join(root, ".apc", "agents", "ceo.md"),
    "---\nname: Ceo\nrole: Chief Executive\n---\n\nDecide.\n",
  );
}

test("a registered project's agents come from its files; edits and removals follow; the owner's choices stay", async () => {
  const llm = scriptedLlm((_r, { system }) =>
    say(system.includes("Use metric units.") ? "saw AGENTS.md" : "no context"),
  );
  const env = await startCore({ llm });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apx2-apc-"));
  try {
    makeProject(root);
    const reg = await env.client.call("projects.register", { path: root });
    assert.equal(reg.project.id, "p_abc123def456");
    assert.equal(reg.project.name, "Northwind");
    assert.equal(reg.agents, 2);
    let { agents } = await env.client.call("agents.list", {});
    const arch = agents.find((a) => a.id === "abc123def456-arch");
    assert.equal(arch?.source, "apc");
    assert.equal(arch?.parent, "ceo");
    assert.equal(arch?.blob, "saturno");
    assert.deepEqual(arch?.model_choice, { model: "gemini/gemini-pro", router: true }, "v1's provider:model, routed");

    // The owner picks another model in APX; the file is edited; the owner's pick survives the reindex.
    await env.client.call("agents.update", {
      agent: "abc123def456-arch",
      model_choice: { model: "claude", router: false },
    });
    fs.writeFileSync(
      path.join(root, ".apc", "agents", "arch.md"),
      "---\nname: Arch\nrole: Principal Architect\n---\n\nSimple.\n",
    );
    fs.rmSync(path.join(root, ".apc", "agents", "ceo.md"));
    const s = await env.client.call("projects.sync", { project: "p_abc123def456" });
    assert.deepEqual(s, { projects: 1, agents: 1, archived: 1 });
    ({ agents } = await env.client.call("agents.list", {}));
    const again = agents.find((a) => a.id === "abc123def456-arch");
    assert.equal(again?.role, "Principal Architect");
    assert.deepEqual(again?.model_choice, { model: "claude", router: false });
    assert.ok(!agents.some((a) => a.id === "abc123def456-ceo"), "removed file → archived, not listed");

    // A project agent works with its project's AGENTS.md in context.
    await env.client.call("agents.update", { agent: "abc123def456-arch", model_choice: null });
    const t = await env.client.call("threads.create", { kind: "agent", agent_id: "abc123def456-arch" });
    assert.equal(t.project_id, "p_abc123def456");
    await env.client.call("threads.send", { thread: t.id, text: "hi" });
    const got = await env.settle(t.id);
    assert.deepEqual(got.messages.at(-1)?.parts, [{ type: "text", text: "saw AGENTS.md" }]);

    // A folder that is not an APC project is refused with a reason.
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "apx2-notapc-"));
    const err = await env.client.call("projects.register", { path: empty }).catch((e: unknown) => e);
    assert.ok(err instanceof ApxError && /not an APC project/.test(err.message));
    fs.rmSync(empty, { recursive: true, force: true });
  } finally {
    await env.core.close();
    env.cleanup();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
