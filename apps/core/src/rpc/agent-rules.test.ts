import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { removeDir } from "../testkit/platform.ts";

let env: Awaited<ReturnType<typeof startCore>>;
let root: string;
let project: string;
before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  root = fs.mkdtempSync(path.join(os.tmpdir(), "apx-rules-"));
  project = (await env.client.call("projects.register", { path: root, init: true })).project.id;
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  await removeDir(root);
});

test("an agent's orchestrator mark and rules by risk are written to its file and read back", async () => {
  const made = await env.client.call("agents.create", {
    project_id: project,
    slug: "lead",
    name: "Lead",
    role: "Orchestrator",
    area: "product",
    orchestrator: true,
  });
  assert.equal(made.orchestrator, true);
  assert.equal(made.area, "product");

  const ruled = await env.client.call("agents.update", {
    agent: made.id,
    rules: { write: "auto", irreversible: "off" },
  });
  assert.deepEqual(ruled.rules, { write: "auto", irreversible: "off" });
  const file = fs.readFileSync(path.join(root, ".apc", "agents", "lead.md"), "utf8");
  assert.match(file, /^orchestrator: true$/m);
  assert.match(file, /^rules: write=auto, irreversible=off$/m);

  const cleared = await env.client.call("agents.update", { agent: made.id, rules: null, orchestrator: false });
  assert.equal(cleared.rules, undefined);
  // Unmarked on purpose: written as false, so its role no longer makes it the head.
  assert.equal(cleared.orchestrator, false);
  const after = fs.readFileSync(path.join(root, ".apc", "agents", "lead.md"), "utf8");
  assert.doesNotMatch(after, /^rules:/m);
  assert.match(after, /^orchestrator: false$/m);
});

test("the tool catalog says each tool's risk", async () => {
  const { tools } = await env.client.call("agents.tools", {});
  const risk = (n: string) => tools.find((t) => t.name === n)?.risk;
  assert.equal(risk("file_read"), "read");
  assert.equal(risk("mcp_call"), "outside");
});
