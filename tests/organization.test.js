// Organization structure (areas + roles) — core store + daemon API.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ProjectManager } from "#host/daemon/db.js";
import { buildApi } from "#host/daemon/api.js";
import {
  readOrganization,
  createArea,
  createRole,
  removeArea,
  slugifyName,
} from "#core/stores/organization.js";
import { makeTempProject, cleanupTempProject } from "./_helpers.js";

async function listen(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

function makeApp(projects) {
  return buildApi({
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
}

test("slugifyName kebab-cases free text", () => {
  assert.equal(slugifyName("Backend Engineering"), "backend-engineering");
  assert.equal(slugifyName("  R&D / Labs  "), "r-d-labs");
});

test("createArea + createRole persist to .apc/organization.json", () => {
  const root = makeTempProject({ name: "Org" });
  try {
    const area = createArea(root, { name: "Engineering" });
    assert.equal(area.slug, "engineering");
    const role = createRole(root, { name: "Backend Dev", area: "engineering" });
    assert.equal(role.slug, "backend-dev");
    assert.equal(role.area, "engineering");

    const org = readOrganization(root);
    assert.equal(org.areas.length, 1);
    assert.equal(org.roles.length, 1);
    assert.ok(fs.existsSync(path.join(root, ".apc", "organization.json")));
  } finally {
    cleanupTempProject(root);
  }
});

test("removeArea detaches its roles instead of deleting them", () => {
  const root = makeTempProject({ name: "Org2" });
  try {
    createArea(root, { name: "Sales" });
    createRole(root, { name: "Rep", area: "sales" });
    removeArea(root, "sales");
    const org = readOrganization(root);
    assert.equal(org.areas.length, 0);
    assert.equal(org.roles.length, 1);
    assert.equal(org.roles[0].area, null);
  } finally {
    cleanupTempProject(root);
  }
});

test("createRole rejects an unknown area", () => {
  const root = makeTempProject({ name: "Org3" });
  try {
    assert.throws(() => createRole(root, { name: "Ghost", area: "nope" }));
  } finally {
    cleanupTempProject(root);
  }
});

test("organization API round-trips areas and roles", async () => {
  const root = makeTempProject({ name: "OrgApi" });
  const projects = new ProjectManager({});
  const { id } = projects.register(root);
  const app = makeApp(projects);
  const { server, baseUrl } = await listen(app);
  try {
    // Empty to start.
    let res = await fetch(`${baseUrl}/projects/${id}/organization`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { areas: [], roles: [] });

    // Create an area.
    res = await fetch(`${baseUrl}/projects/${id}/organization/areas`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Engineering", goal: "ship" }),
    });
    assert.equal(res.status, 201);
    const area = await res.json();
    assert.equal(area.slug, "engineering");

    // Create a role in it.
    res = await fetch(`${baseUrl}/projects/${id}/organization/roles`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Tech Lead", area: "engineering" }),
    });
    assert.equal(res.status, 201);

    // Duplicate area → 400.
    res = await fetch(`${baseUrl}/projects/${id}/organization/areas`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Engineering" }),
    });
    assert.equal(res.status, 400);

    // Delete the role.
    res = await fetch(`${baseUrl}/projects/${id}/organization/roles/tech-lead`, { method: "DELETE" });
    assert.equal(res.status, 200);

    const final = await (await fetch(`${baseUrl}/projects/${id}/organization`)).json();
    assert.equal(final.areas.length, 1);
    assert.equal(final.roles.length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    cleanupTempProject(root);
  }
});
