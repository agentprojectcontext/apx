// AN AGENT IS A PERSON, NOT A FILENAME.
//
// 2026-09-20, from Manu's own screen: Roby created `savia-agent` (no name at
// all, so the panel printed the slug and the role badge beside it read "Savia
// Implementation Agent") and `productor-reels`, which it named "Productor
// Reels" — the slug, spelled out. The group chat then headed that agent's
// bubbles with the address while the "traído por" tag two words away read the
// name: the same agent, one line, two spellings.
//
// The vault importer never had this problem — its role templates ship no
// persona and every install draws one from the pool ("Nora · Chief Financial
// Officer"). These tests hold every OTHER way an agent is born to that rule.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// APX_HOME before the first #core import: takenAgentNames reads config.json
// under it, and a test that writes to the real ~/.apx is a test that eats a day
// of the ledger.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-agent-name-"));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;
process.env.APX_HOME = path.join(tmpHome, ".apx");

const { createAgent } = await import("#core/apc/agent-write.js");
const { agentNamePool, newAgentName } = await import("#core/apc/agent-names.js");
const { readAgents } = await import("#core/apc/parser.js");
const { createRole, readOrganization } = await import("#core/stores/organization.js");
const createAgentTool = (await import("#core/agent/tools/handlers/create-agent.js")).default;
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

const project = (root) => ({ id: `name-${path.basename(root)}`, path: root });
const agent = (root, slug) => readAgents(root).find((a) => a.slug === slug);

/** The create_agent tool, wired to a one-project registry rooted at `root`. */
function makeCreateHandler(root) {
  const entry = { id: 11, name: "acme", path: root };
  return createAgentTool.makeHandler({
    projects: { list: () => [entry], get: (id) => (id === 11 ? entry : null), rebuild: () => {} },
    requirePermission: async () => true,
  });
}

test("an agent created without a name is named from the pool", () => {
  const root = makeTempProject({ name: "unnamed" });
  try {
    createAgent(project(root), { slug: "savia-agent", system: "do things" });
    const name = agent(root, "savia-agent")?.fields?.Name;
    assert.ok(name, "a name-less agent is how the panel ends up printing the slug");
    assert.notEqual(name, "savia-agent", "the slug is an address, not a name");
    assert.ok(agentNamePool().includes(name), `${name} must come from the shared pool`);
  } finally {
    cleanupTempProject(root);
  }
});

test("the name the caller asked for is the name it gets", () => {
  const root = makeTempProject({ name: "named" });
  try {
    createAgent(project(root), { slug: "romi", system: "edit", name: "Romi" });
    assert.equal(agent(root, "romi").fields.Name, "Romi");
  } finally {
    cleanupTempProject(root);
  }
});

test("two agents in the same project do not get the same name", () => {
  const root = makeTempProject({ name: "team" });
  try {
    createAgent(project(root), { slug: "one", system: "x" });
    createAgent(project(root), { slug: "two", system: "x" });
    const [a, b] = ["one", "two"].map((s) => agent(root, s).fields.Name);
    assert.notEqual(a, b);
  } finally {
    cleanupTempProject(root);
  }
});

test("newAgentName avoids the names already on the roster", () => {
  const pool = agentNamePool();
  const taken = pool.slice(0, 3).map((n) => ({ fields: { Name: n } }));
  const picked = newAgentName({ slug: "whoever", roster: taken });
  assert.ok(!pool.slice(0, 3).includes(picked));
});

test("create_agent reads a name that is only the slug as the ROLE it is", async () => {
  const root = makeTempProject({ name: "echo" });
  try {
    const out = await makeCreateHandler(root)({
      project: root, slug: "productor-reels", name: "Productor Reels", system: "x",
    });
    assert.equal(out.ok, true);
    const created = agent(root, "productor-reels").fields;
    assert.notEqual(created.Name, "Productor Reels", "that is the job, not a name");
    assert.equal(created.Role, "Productor Reels", "and nothing the model wrote is thrown away");
    assert.equal(out.name, created.Name, "the answer says which name it ended up with");
  } finally {
    cleanupTempProject(root);
  }
});

test("a one-word slug that matches its name is a person, and is left alone", async () => {
  const root = makeTempProject({ name: "person" });
  try {
    // `romi`/"Romi" is the normal shape of an agent somebody named on purpose;
    // demoting it would rename a person because their handle is their name.
    await makeCreateHandler(root)({ project: root, slug: "romi", name: "Romi", system: "x" });
    assert.equal(agent(root, "romi").fields.Name, "Romi");
  } finally {
    cleanupTempProject(root);
  }
});

test("a role the caller gave is never overwritten by the echoed name", async () => {
  const root = makeTempProject({ name: "roled" });
  try {
    await makeCreateHandler(root)({
      project: root, slug: "qa-engineer", name: "QA Engineer", role: "Ingeniero de QA", system: "x",
    });
    assert.equal(agent(root, "qa-engineer").fields.Role, "Ingeniero de QA");
  } finally {
    cleanupTempProject(root);
  }
});

test("an area nobody created yet is created, with a role for the agent in it", () => {
  const root = makeTempProject({ name: "org" });
  try {
    createAgent(project(root), {
      slug: "savia-agent", system: "x", role: "Savia Implementation Agent", area: "Producto",
      description: "one line",
    });
    const org = readOrganization(root);
    const area = org.areas.find((a) => a.slug === "producto");
    assert.ok(area, "an Area pointing at nothing is invisible to the Structure screen");
    assert.equal(area.name, "Producto");
    const role = org.roles.find((r) => r.slug === "savia-agent");
    assert.ok(role, "a team member belongs on the org chart, not only in the agent list");
    assert.equal(role.name, "Savia Implementation Agent");
    assert.equal(role.area, "producto");
    assert.equal(agent(root, "savia-agent").fields.Area, "producto");
  } finally {
    cleanupTempProject(root);
  }
});

test("a role that is already on the org chart does not block the agent", () => {
  const root = makeTempProject({ name: "twice" });
  try {
    // The structure was written first — by a pack install, by hand, or by an
    // agent that was created and then deleted. Wiring the org is a courtesy on
    // top of creating the agent, never a reason to refuse it.
    createRole(root, { slug: "uno", name: "Uno" });
    createAgent(project(root), { slug: "uno", system: "x", role: "Otro nombre" });
    assert.ok(agent(root, "uno"), "the agent exists");
    assert.equal(readOrganization(root).roles.filter((r) => r.slug === "uno").length, 1);
  } finally {
    cleanupTempProject(root);
  }
});
