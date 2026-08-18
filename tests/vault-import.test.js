// Importing a BUNDLED vault agent has to work on a machine whose user vault is
// empty — which is the normal machine. ~/.apx/agents only holds what the user
// added themselves; the templates APX ships live in assets/agent-vault-defaults.
//
// Regression: the import paths resolved the slug with a hand-built
// `path.join(VAULT_DIR, slug + ".md")`, i.e. the user layer only. So every
// bundled agent failed with `not found in vault. Available: <that same slug>`,
// and readAgents() silently dropped an already-imported one from its project.
// The layered resolver (vaultAgentFile) is now the single way in.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Empty user vault, exactly like a fresh install.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-vault-import-"));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

const {
  vaultAgentFile,
  readVaultAgents,
  readAgents,
  VAULT_DIR,
  BUNDLED_VAULT_DIR,
} = await import("#core/apc/parser.js");
const {
  addImportedAgent,
  writeVaultAgentFile,
  removeVaultAgent,
  restoreVaultAgent,
} = await import("#core/apc/scaffold.js");
const importAgentTool = (await import("#core/agent/tools/handlers/import-agent.js")).default;
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

/** A slug APX ships with, read from the bundle so the test can't rot. */
function aBundledSlug() {
  const slug = readVaultAgents()[0]?.slug;
  assert.ok(slug, "the bundled vault must ship at least one agent");
  return slug;
}

/** The tool handler, wired to a one-project registry rooted at `root`. */
function makeImportHandler(root) {
  const entry = { id: 7, name: "acme", path: root };
  return importAgentTool.makeHandler({
    projects: { list: () => [entry], get: (id) => (id === 7 ? entry : null), rebuild: () => {} },
    requirePermission: async () => true,
  });
}

test("a bundled slug resolves to the bundled file when the user vault is empty", () => {
  const slug = aBundledSlug();
  assert.equal(fs.existsSync(path.join(VAULT_DIR, `${slug}.md`)), false, "user vault starts empty");
  const file = vaultAgentFile(slug);
  assert.ok(file, `${slug} must resolve — it is what list_vault_agents offers`);
  assert.equal(path.dirname(file), BUNDLED_VAULT_DIR);
});

test("the user layer wins over the bundled default for the same slug", () => {
  const slug = aBundledSlug();
  try {
    writeVaultAgentFile(slug, { Role: "override" }, "local body");
    assert.equal(path.dirname(vaultAgentFile(slug)), VAULT_DIR);
  } finally {
    // Deleting a user file over a bundled slug also tombstones it — undo both.
    removeVaultAgent(slug);
    restoreVaultAgent(slug);
  }
});

test("vaultAgentFile refuses junk, and hides a tombstoned template", () => {
  assert.equal(vaultAgentFile(""), null);
  assert.equal(vaultAgentFile("../../etc/passwd"), null, "a slug is not a path");
  const slug = aBundledSlug();
  removeVaultAgent(slug); // bundled → tombstone
  try {
    assert.equal(vaultAgentFile(slug), null, "a hidden template does not resolve");
    assert.ok(
      vaultAgentFile(slug, { includeRemoved: true }),
      "…but a project that already imported it keeps resolving",
    );
  } finally {
    restoreVaultAgent(slug);
  }
});

test("import_agent imports a bundled agent, and the project can see it", async () => {
  const root = makeTempProject({ name: "acme" });
  try {
    const slug = aBundledSlug();
    const out = await makeImportHandler(root)({ project: root, agent: slug });
    assert.equal(out.ok, true);
    assert.equal(out.agent, slug);
    assert.equal(path.dirname(out.source), BUNDLED_VAULT_DIR);

    const inProject = readAgents(root).find((a) => a.slug === slug);
    assert.ok(inProject, "an imported bundled agent must show up in the project");
    assert.equal(inProject.source, "vault");
  } finally {
    cleanupTempProject(root);
  }
});

test("import_agent still rejects a slug that exists nowhere", async () => {
  const root = makeTempProject({ name: "northwind" });
  try {
    await assert.rejects(
      () => makeImportHandler(root)({ project: root, agent: "no-such-agent" }),
      /not found in vault/,
    );
  } finally {
    cleanupTempProject(root);
  }
});

test("readAgents resolves an imported bundled slug (it used to vanish)", () => {
  const root = makeTempProject({ name: "northwind" });
  try {
    const slug = aBundledSlug();
    addImportedAgent(root, slug);
    const found = readAgents(root).find((a) => a.slug === slug);
    assert.ok(found, "the project registered it; reading the project must find it");
  } finally {
    cleanupTempProject(root);
  }
});
