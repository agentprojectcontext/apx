// The system prompt (the .md body) is edited on its own surface — the web
// Prompt tab — while the config form saves identity/behavior fields without it.
// Both halves lean on PATCH being a real partial update: `system` alone rewrites
// the body and keeps the frontmatter, and a PATCH with no `system` leaves the
// body byte-identical.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ProjectManager } from "#host/daemon/db.js";
import { buildApi } from "#host/daemon/api.js";
import { makeTempProject, cleanupTempProject } from "./_helpers.js";

async function listen(app) {
  const server = app.listen(0);
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

const json = { "content-type": "application/json" };

// Only the single-agent GET carries the body (the PATCH/list responses stay
// frontmatter-only), which is exactly the read the web tabs revalidate after a
// save — so that is what the assertions go through.
const get = async (baseUrl, id) =>
  (await fetch(`${baseUrl}/api/projects/${id}/agents/rocky`)).json();
const PROMPT = "# Rocky\n\nYou are **Rocky**, the project manager.\n";

async function seed(baseUrl, id) {
  const r = await fetch(`${baseUrl}/api/projects/${id}/agents`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({
      slug: "rocky", name: "Rocky PM", role: "pm", model: "claude-opus-5",
      autonomy: "permiso", type: "specialist", description: "converts specs into tasks",
      system: PROMPT,
    }),
  });
  assert.equal(r.status, 201);
  return r.json();
}

test("PATCH { system } rewrites the body and keeps the frontmatter", async () => {
  const root = makeTempProject({});
  const { app, id } = makeApp(root);
  const { server, baseUrl } = await listen(app);
  try {
    await seed(baseUrl, id);
    const next = `${PROMPT}\n## Responsibilities\n\n- Read the research\n`;

    const r = await fetch(`${baseUrl}/api/projects/${id}/agents/rocky`, {
      method: "PATCH", headers: json, body: JSON.stringify({ system: next }),
    });
    assert.equal(r.status, 200);
    const updated = await get(baseUrl, id);

    // trimEnd: the reader normalizes the trailing newline off the body.
    assert.equal(updated.system, next.trimEnd());
    // Everything the config form owns survives a prompt-only save.
    assert.equal(updated.name, "Rocky PM");
    assert.equal(updated.role, "pm");
    assert.equal(updated.model, "claude-opus-5");
    assert.equal(updated.autonomy, "permiso");
    assert.equal(updated.type, "specialist");
    assert.equal(updated.description, "converts specs into tasks");

    const md = fs.readFileSync(path.join(root, ".apc", "agents", "rocky.md"), "utf8");
    assert.match(md, /autonomy: permiso/);
    assert.ok(md.includes("## Responsibilities"));
  } finally {
    await new Promise((res) => server.close(res));
    cleanupTempProject(root);
  }
});

test("PATCH without `system` leaves the prompt untouched", async () => {
  const root = makeTempProject({});
  const { app, id } = makeApp(root);
  const { server, baseUrl } = await listen(app);
  try {
    await seed(baseUrl, id);
    const before = await get(baseUrl, id);

    // Exactly the payload the config form sends now that the prompt moved out.
    const r = await fetch(`${baseUrl}/api/projects/${id}/agents/rocky`, {
      method: "PATCH",
      headers: json,
      body: JSON.stringify({
        name: "Rocky", role: "manager", autonomy: "automatico",
        description: "same as before", skills: [], tools: ["read", "write"],
      }),
    });
    assert.equal(r.status, 200);
    const updated = await get(baseUrl, id);

    assert.equal(updated.system, before.system);
    assert.match(updated.system, /You are \*\*Rocky\*\*/);
    assert.equal(updated.name, "Rocky");
    assert.equal(updated.autonomy, "automatico");
    assert.deepEqual(updated.tools, ["read", "write"]);
  } finally {
    await new Promise((res) => server.close(res));
    cleanupTempProject(root);
  }
});
