// Importing ONE vault template gives it the same identity a TEAM install does.
//
// A pack install names its members at install time and hands each one a face
// the project is not already wearing (planPackInstall → pickAgentName,
// buildNewAgentFields → pickBlob). The single-template route wrote the
// template's frontmatter straight to disk, so the very same `cfo` that becomes
// "Briar · Chief Financial Officer" through the team dialog became "cfo / cfo"
// with no avatar through the card sitting next to it in the same dialog.
//
// The role templates are the ones that ship no `name:` — which is the point of
// them, and exactly why the naming cannot live in the template.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-vault-naming-"));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;
process.env.APX_HOME = path.join(tmpHome, ".apx");

const { ProjectManager } = await import("#host/daemon/db.js");
const { buildApi } = await import("#host/daemon/api.js");
const { writeVaultAgentFile } = await import("#core/apc/scaffold.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

const json = { "content-type": "application/json" };

async function listen(app) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

function makeApp(root) {
  const projects = new ProjectManager({});
  const { id } = projects.register(root);
  const app = buildApi({
    projects,
    registries: null,
    plugins: { get: () => null, status: () => ({}) },
    scheduler: null,
    version: "test",
    startedAt: Date.now(),
    addProjectGlobally: () => {},
    config: { host: "127.0.0.1", port: 7430 },
    token: "",
  });
  return { app, id };
}

/** Templates written here rather than read from the bundle: what this asserts
 *  is the ROUTE's behaviour, and it must not start passing or failing because
 *  somebody added a `name:` to a shipped template. */
function seedVault() {
  writeVaultAgentFile("roleish", { Role: "Chief Whatever Officer" }, "You are the CWO.");
  writeVaultAgentFile("roleish2", { Role: "Second Whatever Officer" }, "You are the SWO.");
  writeVaultAgentFile("persona", { Name: "Wilma", Role: "Persona", Icon: "noche" }, "You are Wilma.");
}

const importAgent = (baseUrl, id, slug) =>
  fetch(`${baseUrl}/api/projects/${id}/agents/import`, {
    method: "POST", headers: json, body: JSON.stringify({ slug }),
  });

test("a template with no name is named and given a face on import", async () => {
  const root = makeTempProject({ name: "acme" });
  seedVault();
  const { app, id } = makeApp(root);
  const { server, baseUrl } = await listen(app);
  try {
    const one = await importAgent(baseUrl, id, "roleish");
    assert.equal(one.status, 201);
    const a = await one.json();
    assert.ok(a.name, "an imported role template must not land nameless");
    assert.notEqual(a.name.toLowerCase(), "roleish", "and the name must not just be the slug");
    assert.ok(a.icon, "it gets a face, like every pack member does");

    // The one thing a second import must not do is hand out the same identity.
    const two = await importAgent(baseUrl, id, "roleish2");
    assert.equal(two.status, 201);
    const b = await two.json();
    assert.notEqual(b.name, a.name, "two imports into one project are told apart");
    assert.notEqual(b.icon, a.icon);

    // And it is on DISK, not only in the response: the frontmatter is what the
    // next reader sees.
    const fm = fs.readFileSync(path.join(root, ".apc", "agents", "roleish.md"), "utf8");
    assert.match(fm, new RegExp(`^name: ${a.name}$`, "m"));
  } finally {
    server.close();
    cleanupTempProject(root);
  }
});

test("a template that ships a persona keeps its own name and face", async () => {
  const root = makeTempProject({ name: "acme2" });
  seedVault();
  const { app, id } = makeApp(root);
  const { server, baseUrl } = await listen(app);
  try {
    const r = await importAgent(baseUrl, id, "persona");
    assert.equal(r.status, 201);
    const a = await r.json();
    assert.equal(a.name, "Wilma");
    assert.equal(a.icon, "noche");
  } finally {
    server.close();
    cleanupTempProject(root);
  }
});
