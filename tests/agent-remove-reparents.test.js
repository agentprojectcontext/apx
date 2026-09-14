// Deleting an agent does not take its team down with it.
//
// Installing a team, deciding you did not want its lead after all and deleting
// it is a completely normal sequence — it is what "two orchestrators are
// fighting" pushes you to do. `removeAgent` deleted the file and stopped there,
// so every report kept `Parent: <a slug that is gone>`. That resolves to
// nothing: they drop to the top level, out of whatever the lead belonged to,
// with no error and nothing on screen saying what happened.
//
// renameAgent has always repointed children. Remove — the destructive one —
// did not.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-remove-reparent-"));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;
process.env.APX_HOME = path.join(tmpHome, ".apx");

const { createAgent, removeAgent, setAgentConfig } = await import("#core/apc/agent-write.js");
const { readAgents } = await import("#core/apc/parser.js");
const { installPack } = await import("#core/apc/agent-packs.js");
const { readOrganization } = await import("#core/stores/organization.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

const parentOf = (root, slug) =>
  readAgents(root).find((a) => a.slug === slug)?.fields?.Parent ?? null;

test("a removed agent's reports move up to its own parent", () => {
  const root = makeTempProject({ name: "acme" });
  const project = { id: 1, path: root };
  try {
    createAgent(project, { slug: "boss", system: "." });
    createAgent(project, { slug: "lead", parent: "boss", system: "." });
    createAgent(project, { slug: "dev", parent: "lead", system: "." });
    createAgent(project, { slug: "qa", parent: "lead", system: "." });

    removeAgent(project, "lead");

    assert.equal(parentOf(root, "dev"), "boss", "a report follows the chain up, not into nothing");
    assert.equal(parentOf(root, "qa"), "boss");
    // And nothing else moved.
    assert.equal(parentOf(root, "boss"), null);
  } finally {
    cleanupTempProject(root);
  }
});

test("removing a ROOT lead leaves its reports at the top, not pointing at a ghost", () => {
  const root = makeTempProject({ name: "acme2" });
  const project = { id: 1, path: root };
  try {
    createAgent(project, { slug: "lead", is_master: true, system: "." });
    createAgent(project, { slug: "dev", parent: "lead", system: "." });

    removeAgent(project, "lead");

    assert.equal(parentOf(root, "dev"), null, "no parent is honest; a dangling one is not");
    const fm = fs.readFileSync(path.join(root, ".apc", "agents", "dev.md"), "utf8");
    assert.doesNotMatch(fm, /^parent:/m, "the dead pointer is gone from disk too");
  } finally {
    cleanupTempProject(root);
  }
});

test("deleting a team's lead keeps the team under whoever the lead reported to", () => {
  const root = makeTempProject({ name: "acme3" });
  const project = { id: 1, path: root };
  try {
    // The shape that produced this: a company, then a build team under its CEO.
    installPack(project, "company");
    const build = installPack(project, "dev-team");
    const lead = build.installed.find((a) => a.template === "orchestrator").slug;
    // Put the build lead under the CEO, the way somebody sorting this out would.
    setAgentConfig(project, lead, { parent: "ceo" });

    const reports = build.installed.filter((a) => a.template !== "orchestrator").map((a) => a.slug);
    removeAgent(project, lead);

    for (const slug of reports) {
      assert.equal(parentOf(root, slug), "ceo", `${slug} lands under the CEO, not nowhere`);
    }
  } finally {
    cleanupTempProject(root);
  }
});

test("the build team installs with its own structure, and mixes with the company's", () => {
  const root = makeTempProject({ name: "acme4" });
  const project = { id: 1, path: root };
  try {
    const build = installPack(project, "dev-team");
    const areas = readOrganization(root).areas.map((a) => a.slug);
    assert.ok(areas.includes("engineering") && areas.includes("product") && areas.includes("quality"));

    // Every member lands in one — "SIN CATEGORÍA" was the whole team.
    for (const entry of build.installed) {
      const agent = readAgents(root).find((a) => a.slug === entry.slug);
      assert.ok(agent.fields.Area, `${entry.slug} must belong to an area`);
      assert.ok(areas.includes(agent.fields.Area), `${entry.slug}'s area must exist`);
    }

    // The company pack on top shares direction/growth/finance rather than
    // creating a second set, so the two read as one org chart.
    const before = readOrganization(root).areas.length;
    installPack(project, "company");
    const after = readOrganization(root).areas;
    assert.equal(after.length, before + 3, "only operations, people and legal are new");
    assert.equal(new Set(after.map((a) => a.slug)).size, after.length, "no area is created twice");
  } finally {
    cleanupTempProject(root);
  }
});
