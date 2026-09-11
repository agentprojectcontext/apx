// Unregistering a project has to survive a restart.
//
// THE BUG. `POST /projects` does two things: registers the project with the
// running daemon AND writes its path into ~/.apx/config.json, which is what
// boot reads back. `DELETE /projects/:id` only ever did the first — it dropped
// the entry from the in-memory maps and left the file alone. So:
//
//   · a project removed from the panel came back on the next `apx restart`
//   · one whose folder was gone stayed in config.json forever, invisible in the
//     project list (boot skips a path it cannot register) but right there in
//     Config APX › JSON
//
// 58 entries on this machine, 37 of them dead: e2e temp dirs, worktrees,
// /tmp checkouts. web/e2e/throwaway.ts had to reach into the config module and
// delete its own path after every run, and its comment says why in as many
// words. That workaround is now a backstop, not the mechanism.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-unreg-"));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;
// APX_HOME and not HOME alone: the runner sets its own, and it wins.
process.env.APX_HOME = path.join(tmpHome, ".apx");

const { ProjectManager } = await import("#host/daemon/db.js");
const { buildApi } = await import("#host/daemon/api.js");
const { readConfig, addProject, removeProject } = await import("#core/config/index.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

async function listen(app) {
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

test("DELETE /projects/:id takes the path out of the global config too", async () => {
  const root = makeTempProject({ name: "gone-tomorrow" });
  const projects = new ProjectManager({});
  const { id } = projects.register(root);

  const removed = [];
  const app = buildApi({
    projects,
    registries: { ensure: () => {} },
    plugins: { get: () => null, status: () => ({}) },
    scheduler: null,
    version: "test",
    startedAt: Date.now(),
    addProjectGlobally: () => {},
    removeProjectGlobally: (p) => removed.push(p),
    config: { host: "127.0.0.1", port: 7430 },
    token: "",
  });
  const { server, baseUrl } = await listen(app);
  try {
    const res = await fetch(`${baseUrl}/api/projects/${id}`, { method: "DELETE" });
    assert.equal(res.status, 204);
    // The PATH, not the id: `removeProject`'s numeric branch reads a number as
    // a 1-based index into the config array, so passing the daemon's id would
    // delete whichever project happens to sit at that offset.
    assert.deepEqual(removed, [path.resolve(root)]);

    // A second delete finds nothing and must not touch the config again.
    const again = await fetch(`${baseUrl}/api/projects/${id}`, { method: "DELETE" });
    assert.equal(again.status, 404);
    assert.equal(removed.length, 1, "a 404 unregisters nothing, so it removes nothing");
  } finally {
    server.close();
    cleanupTempProject(root);
  }
});

test("the config round-trips: added, then really gone from the file", () => {
  const root = makeTempProject({ name: "round-trip" });
  try {
    addProject(readConfig(), root);
    assert.ok(
      readConfig().projects.some((p) => path.resolve(p.path) === path.resolve(root)),
      "registering persists the path",
    );
    const { removed } = removeProject(readConfig(), root);
    assert.equal(removed, 1);
    assert.equal(
      readConfig().projects.some((p) => path.resolve(p.path) === path.resolve(root)),
      false,
      "and unregistering takes it back out of the file on disk",
    );
  } finally {
    cleanupTempProject(root);
  }
});

test("the daemon hands the route a remover that writes the file", () => {
  // The closure lives inside the boot function, which cannot be imported
  // without starting a daemon — so the contract is checked on the source.
  const index = read("src/host/daemon/index.js");
  assert.match(index, /removeProject as removeProjectInConfig/);
  assert.match(
    index,
    /removeProjectGlobally: \(absPath\) => \{[\s\S]*removeProjectInConfig\(fresh, absPath\)/,
    "and it re-reads the config first, like its add twin",
  );
});

test("a project whose folder is gone is never pruned behind your back", () => {
  // Deliberate: these paths live on an external drive. Unmount it and every
  // project looks deleted — a boot-time "clean up what does not exist" would
  // empty the registry because a disk was not plugged in.
  const index = read("src/host/daemon/index.js");
  const boot = index.slice(index.indexOf("for (const entry of cfg.projects)"));
  const firstLines = boot.slice(0, 400);
  assert.doesNotMatch(firstLines, /removeProjectInConfig|existsSync/, "boot skips, it does not delete");
  assert.match(firstLines, /skipping project/);
});
