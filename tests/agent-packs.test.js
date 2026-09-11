// A pack installs a TEAM, and the interesting case is never the empty project —
// it is the project that already has an agent holding one of the slugs. Then
// every Parent in the pack has to point at the member that was just installed,
// not at the stranger that happened to own the name first. A dangling or
// misdirected Parent is silent: the agent still works, it just reports to the
// wrong orchestrator forever.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-packs-"));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;
process.env.APX_HOME = path.join(tmpHome, ".apx");

const { readPacks, getPack, planPackInstall, installPack } = await import("#core/apc/agent-packs.js");
const { readVaultAgents, readAgents } = await import("#core/apc/parser.js");
const { readOrganization } = await import("#core/stores/organization.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

const asProject = (root) => ({ id: `pack-${path.basename(root)}`, path: root });
const bySlug = (plan, template) => plan.agents.find((a) => a.template === template);

test("every pack names templates that actually ship", () => {
  const vault = new Set(readVaultAgents().map((a) => a.slug));
  for (const pack of readPacks()) {
    assert.ok(pack.name, `pack ${pack.id} needs a name`);
    assert.ok(pack.explain, `pack ${pack.id} needs an explanation the UI can show`);
    for (const entry of pack.agents) {
      assert.ok(vault.has(entry.slug), `pack ${pack.id} names a missing template: ${entry.slug}`);
      if (entry.parent) {
        assert.ok(
          pack.agents.some((a) => a.slug === entry.parent),
          `pack ${pack.id}: ${entry.slug} reports to ${entry.parent}, which is not in the pack`,
        );
      }
    }
  }
});

test("the company pack is an orchestrator plus its council", () => {
  const pack = getPack("company");
  assert.equal(pack.agents.length, 6);
  assert.equal(pack.agents[0].slug, "ceo");
  assert.ok(pack.agents.slice(1).every((a) => a.parent === "ceo"));
});

test("on an empty project every slug keeps its own name", () => {
  const root = makeTempProject({ name: "empty" });
  try {
    const plan = planPackInstall(root, "company");
    const selected = plan.agents.filter((a) => a.selected);
    assert.equal(selected.length, 6);
    assert.ok(selected.every((a) => a.slug === a.template));
    assert.ok(selected.every((a) => !a.renamed));
    assert.equal(bySlug(plan, "cfo").parent, "ceo");
  } finally {
    cleanupTempProject(root);
  }
});

test("a taken slug moves to its alias and the team follows it, not the stranger", () => {
  const root = makeTempProject({ name: "busy", agents: [{ slug: "ceo", role: "Not ours" }] });
  try {
    const plan = planPackInstall(root, "company");
    const ceo = bySlug(plan, "ceo");
    assert.equal(ceo.slug, "chief", "the pack's CEO steps aside for the existing one");
    assert.ok(ceo.renamed);
    // The whole point: the council reports to the CEO we just installed.
    for (const t of ["cfo", "coo", "cmo", "chro", "gc"]) {
      assert.equal(bySlug(plan, t).parent, "chief", `${t} must report to the installed CEO`);
    }
  } finally {
    cleanupTempProject(root);
  }
});

test("with the alias taken too it falls back to a numeric suffix", () => {
  const root = makeTempProject({
    name: "busier",
    agents: [{ slug: "cfo", role: "a" }, { slug: "finance-lead", role: "b" }],
  });
  try {
    const plan = planPackInstall(root, "company");
    const cfo = bySlug(plan, "cfo");
    assert.equal(cfo.slug, "cfo-2");
    assert.equal(cfo.name, "CFO (2)", "a numeric collision marks the name instead of duplicating it");
  } finally {
    cleanupTempProject(root);
  }
});

test("an unselected parent leaves the child at the top level, never dangling", () => {
  const root = makeTempProject({ name: "partial" });
  try {
    const plan = planPackInstall(root, "company", { only: ["gc"] });
    const gc = bySlug(plan, "gc");
    assert.equal(gc.selected, true);
    assert.equal(gc.parent, null, "a Parent pointing at an agent that was not installed is worse than none");
    assert.equal(bySlug(plan, "ceo").selected, false);
  } finally {
    cleanupTempProject(root);
  }
});

test("install writes the team, its areas, its roles and six different faces", () => {
  const root = makeTempProject({ name: "install" });
  try {
    const out = installPack(asProject(root), "company");
    assert.equal(out.installed.length, 6);

    const roster = readAgents(root);
    assert.equal(roster.length, 6);

    const ceo = roster.find((a) => a.slug === "ceo");
    assert.equal(ceo.fields.Type, "orchestrator");
    assert.equal(String(ceo.fields.Master).toLowerCase(), "true", "the CEO is the project's master agent");
    assert.equal(roster.find((a) => a.slug === "gc").fields.Parent, "ceo");

    const faces = roster.map((a) => a.fields.Icon).filter(Boolean);
    assert.equal(new Set(faces).size, faces.length, "a team whose members share a face is unreadable");

    const org = readOrganization(root);
    for (const slug of ["direction", "finance", "operations", "growth", "people", "legal"]) {
      assert.ok(org.areas.some((a) => a.slug === slug), `missing area ${slug}`);
    }
    assert.equal(org.roles.length, 6, "the team has to show up in the project structure too");
    assert.equal(org.roles.find((r) => r.slug === "cfo").area, "finance");

    // The body is the system prompt: it has to arrive, not just the frontmatter.
    assert.match(fs.readFileSync(path.join(root, ".apc", "agents", "ceo.md"), "utf8"), /NO_MESSAGE/);
  } finally {
    cleanupTempProject(root);
  }
});

test("installing into a project that already has the team does not collide", () => {
  const root = makeTempProject({ name: "twice" });
  try {
    installPack(asProject(root), "company", { only: ["ceo"] });
    const out = installPack(asProject(root), "company", { only: ["ceo"] });
    assert.equal(out.installed[0].slug, "chief");
    assert.equal(readAgents(root).length, 2);
  } finally {
    cleanupTempProject(root);
  }
});

test("an explicit name wins, and a taken one is refused before anything is written", () => {
  const root = makeTempProject({ name: "named", agents: [{ slug: "boss", role: "x" }] });
  try {
    const plan = planPackInstall(root, "company", { only: ["ceo"], names: { ceo: "jefa" } });
    assert.equal(bySlug(plan, "ceo").slug, "jefa");
    assert.throws(
      () => planPackInstall(root, "company", { only: ["ceo"], names: { ceo: "boss" } }),
      /already exists/,
    );
    assert.throws(
      () => planPackInstall(root, "company", { only: ["ceo"], names: { ceo: "No Valido" } }),
      /invalid slug/,
    );
  } finally {
    cleanupTempProject(root);
  }
});

test("a council added to a project that already has its lead reports to that lead", () => {
  // The normal shape of "add the executives to Appsi": the CEO is already
  // there, so installing the rest must hang off it instead of orphaning them.
  const root = makeTempProject({ name: "has-lead", agents: [{ slug: "ceo", role: "CEO" }] });
  try {
    const plan = planPackInstall(root, "company", { only: ["cfo", "gc"] });
    assert.equal(bySlug(plan, "cfo").parent, "ceo");
    assert.equal(bySlug(plan, "gc").parent, "ceo");
    assert.equal(bySlug(plan, "cfo").slug, "cfo", "the council's own slugs are still free");
  } finally {
    cleanupTempProject(root);
  }
});
