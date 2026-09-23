// A PROJECT's profile, over HTTP.
//
// The profiles API was entirely super-agent-scoped: `apx profile use company
// --project x` went straight to core and never through the daemon, so the panel
// had no way to reach it. A project could therefore sit marked `kind: company`
// — Structure in the rail, the executive team installed — with not one ritual
// running and nothing on screen saying why.
//
// What these cover is the part a thin adapter still gets wrong: that the
// daemon's project object is enough for core (it carries a path, not a
// storagePath), that a super-agent package is refused here rather than
// half-applied, and that `agents` answers the question the UI actually asks —
// who these routines will address, resolved against THIS project's settings.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-project-profile-"));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;
process.env.APX_HOME = path.join(tmpHome, ".apx");

const { ProjectManager } = await import("#host/daemon/db.js");
const { buildApi } = await import("#host/daemon/api.js");
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

test("a project runs no profile until one is activated, and can be stood back down", async () => {
  const root = makeTempProject({ name: "acme" });
  const { app, id } = makeApp(root);
  const { server, baseUrl } = await listen(app);
  try {
    const before = await (await fetch(`${baseUrl}/api/projects/${id}/profile`)).json();
    assert.equal(before.active, null, "a fresh project runs vanilla");

    const company = before.available.find((p) => p.id === "company");
    assert.ok(company, "the bundled company package must be offered to a project");
    assert.ok(
      before.available.every((p) => p.id !== "secretary"),
      "a super-agent package is not an option for a project",
    );

    // The whole point of `agents`: these routines name agents, and a project
    // that never imported them gets nine runs addressed to nobody.
    assert.ok(company.agents.includes("ceo"), "the rituals address the orchestrator_agent");
    for (const slug of ["cfo", "coo", "cmo", "chro", "gc"]) {
      assert.ok(company.agents.includes(slug), `the council routines address ${slug}`);
    }

    const used = await fetch(`${baseUrl}/api/projects/${id}/profile`, {
      method: "POST", headers: json, body: JSON.stringify({ id: "company" }),
    });
    assert.equal(used.status, 200);
    const after = await used.json();
    assert.equal(after.active, "company");
    assert.equal(
      after.routines.installed.length,
      company.provides.routines.length,
      "every routine the manifest promises is installed",
    );
    // The activation travels with the repo, not with the machine.
    const meta = JSON.parse(fs.readFileSync(path.join(root, ".apc", "project.json"), "utf8"));
    assert.equal(meta.profile.active, "company");

    const off = await (await fetch(`${baseUrl}/api/projects/${id}/profile`, { method: "DELETE" })).json();
    assert.equal(off.active, null);
    // The package ships its costly rituals OFF: only the CEO's weekly review and
    // monthly scorecard start on. Standing down disables what was running.
    assert.deepEqual(after.routines.off.sort(), [
      "company-council-cfo", "company-council-chro", "company-council-cmo", "company-council-coo",
      "company-council-gc", "company-daily-pulse", "company-decision-brief",
    ]);
    assert.equal(off.disabled.length, after.routines.installed.length - after.routines.off.length,
      "standing down disables every routine that was on");
  } finally {
    server.close();
    cleanupTempProject(root);
  }
});

test("a super-agent package cannot be activated on a project, and an unknown id is a 400", async () => {
  const root = makeTempProject({ name: "acme2" });
  const { app, id } = makeApp(root);
  const { server, baseUrl } = await listen(app);
  try {
    const wrongScope = await fetch(`${baseUrl}/api/projects/${id}/profile`, {
      method: "POST", headers: json, body: JSON.stringify({ id: "secretary" }),
    });
    assert.equal(wrongScope.status, 400);
    assert.match((await wrongScope.json()).error, /super-agent/i);

    const missing = await fetch(`${baseUrl}/api/projects/${id}/profile`, {
      method: "POST", headers: json, body: JSON.stringify({ id: "nope" }),
    });
    assert.equal(missing.status, 400);

    const noBody = await fetch(`${baseUrl}/api/projects/${id}/profile`, {
      method: "POST", headers: json, body: "{}",
    });
    assert.equal(noBody.status, 400);

    // None of that may have half-activated anything.
    const state = await (await fetch(`${baseUrl}/api/projects/${id}/profile`)).json();
    assert.equal(state.active, null);
  } finally {
    server.close();
    cleanupTempProject(root);
  }
});
