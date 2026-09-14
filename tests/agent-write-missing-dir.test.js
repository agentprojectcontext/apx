// Writing an agent into a project that has never had one.
//
// `.apc/agents/` is not created by `apx project add` — a project registered and
// left alone has `.apc/` with project.json and nothing else. Every writer
// reached for `fs.writeFileSync(.apc/agents/<slug>.md)` and `installPack`
// called ensureAgentDir on the line AFTER the write, so the first member of a
// team threw ENOENT — with the pack's six areas already on disk.
//
// The state that left behind is the worst kind: the project reads as a company
// (Structure full of areas, kind: company) with no agents and no roles, no
// error anywhere but the toast that already scrolled away. Seen live on a real
// project, which is what this test is here to stop.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-missing-agents-dir-"));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;
process.env.APX_HOME = path.join(tmpHome, ".apx");

const { writeAgentFile } = await import("#core/apc/scaffold.js");
const { installPack } = await import("#core/apc/agent-packs.js");
const { readOrganization } = await import("#core/stores/organization.js");
const { readAgents } = await import("#core/apc/parser.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

/** A project as `apx project add` leaves it: .apc/, project.json, no agents/. */
function projectWithoutAgentsDir() {
  const root = makeTempProject({ name: "bare" });
  fs.rmSync(path.join(root, ".apc", "agents"), { recursive: true, force: true });
  return root;
}

test("writeAgentFile creates .apc/agents when it does not exist", () => {
  const root = projectWithoutAgentsDir();
  try {
    writeAgentFile(root, "solo", { Name: "Solo", Role: "Tester" }, "You test.");
    assert.equal(readAgents(root).length, 1);
    assert.equal(readAgents(root)[0].fields.Name, "Solo");
  } finally {
    cleanupTempProject(root);
  }
});

test("a team installs into a project that never had an agent — areas AND agents", () => {
  const root = projectWithoutAgentsDir();
  try {
    const out = installPack({ id: 1, path: root }, "company");
    assert.ok(out.installed.length >= 6, "every default member is written");

    const org = readOrganization(root);
    assert.ok(org.areas.length >= 6, "the pack's areas are created");
    assert.equal(
      org.roles.length,
      out.installed.length,
      "and a role per member — the step that never ran when the write threw",
    );

    const slugs = readAgents(root).map((a) => a.slug).sort();
    assert.deepEqual(slugs, out.installed.map((a) => a.slug).sort());
  } finally {
    cleanupTempProject(root);
  }
});
