// A profile activated by a PROJECT. The two things that must be true, because
// everything else in this feature depends on them:
//
//   1. Its routines land in THAT project's storage. If they landed in the
//      super-agent's (the old hardcoded path), every company on this machine
//      would be running every other company's rituals.
//   2. Its prompt reaches the project's own agents — which until now saw
//      nothing at all from core/profiles — and NOT the super-agent's head.
//
// And the invariant that protects the old behaviour: a project package must be
// refused on the super-agent, because activating it there would stand down
// whatever profile the super-agent runs.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-projprofile-"));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;
process.env.APX_HOME = path.join(tmpHome, ".apx");

const {
  useProjectProfile,
  offProjectProfile,
  removeProjectProfile,
  setProjectProfileConfig,
  readProjectProfileState,
  buildProjectProfileBlock,
  projectRoutineStorage,
} = await import("#core/profiles/project.js");
const { useProfile } = await import("#core/profiles/lifecycle.js");
const { listRoutines } = await import("#core/stores/routines.js");
const { projectStorageRoot } = await import("#core/config/paths.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

/** A project-scoped package in the user layer, exactly as one would ship. */
function installFixture(id = "acme", { scope = "project" } = {}) {
  const dir = path.join(process.env.APX_HOME, "profiles", id);
  fs.mkdirSync(path.join(dir, "routines"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "profile.json"),
    JSON.stringify({ id, name: "Acme", version: "1.0.0", scope, prompt_budget_tokens: 400 }),
  );
  fs.writeFileSync(
    path.join(dir, "PROFILE.md"),
    "One voice out. Above you is {{super_agent_name}}, and it is the only one who writes to {{owner_name}}. Cap: {{weekly_deliveries}}.",
  );
  fs.writeFileSync(
    path.join(dir, "config.schema.json"),
    JSON.stringify({
      type: "object",
      properties: { weekly_deliveries: { type: "integer", default: 4 } },
    }),
  );
  fs.writeFileSync(
    path.join(dir, "routines", "pulse.json"),
    JSON.stringify({ name: "pulse", kind: "exec_agent", schedule: "15 8 * * *", payload: { agent: "ceo" } }),
  );
  return dir;
}

const projectOf = (root) => ({ path: root });
const apxIdOf = (root) =>
  JSON.parse(fs.readFileSync(path.join(root, ".apc", "project.json"), "utf8")).apx_id;

test("its routines land in the project's own storage, not the super-agent's", () => {
  installFixture();
  const root = makeTempProject({ name: "acme" });
  try {
    const out = useProjectProfile(projectOf(root), "acme");
    assert.equal(out.id, "acme");

    const mine = listRoutines(projectStorageRoot(apxIdOf(root))).map((r) => r.name);
    assert.deepEqual(mine, ["acme-pulse"], "namespaced, and in this project");

    const superAgent = listRoutines(projectStorageRoot("default")).map((r) => r.name);
    assert.ok(!superAgent.includes("acme-pulse"), "the super-agent must not inherit a company's rituals");
  } finally {
    cleanupTempProject(root);
  }
});

test("the activation is recorded in .apc so it travels with the repo", () => {
  installFixture();
  const root = makeTempProject({ name: "travels" });
  try {
    useProjectProfile(projectOf(root), "acme");
    const meta = JSON.parse(fs.readFileSync(path.join(root, ".apc", "project.json"), "utf8"));
    assert.equal(meta.profile.active, "acme");
    assert.equal(meta.profile.configs.acme.weekly_deliveries, 4, "seeded from the schema defaults");
  } finally {
    cleanupTempProject(root);
  }
});

test("the block renders with this machine's super-agent name, not a hardcoded one", () => {
  installFixture();
  const root = makeTempProject({ name: "block" });
  try {
    useProjectProfile(projectOf(root), "acme");
    const block = buildProjectProfileBlock(root, { owner_name: "Manu" }, { super_agent: { name: "Roby" } });
    assert.match(block, /Above you is Roby/);
    assert.match(block, /writes to Manu/);
    assert.match(block, /Cap: 4/);
    assert.doesNotMatch(block, /\{\{/, "an unresolved variable would reach the model as literal braces");
  } finally {
    cleanupTempProject(root);
  }
});

test("a project with no profile contributes nothing at all", () => {
  const root = makeTempProject({ name: "vanilla" });
  try {
    assert.equal(buildProjectProfileBlock(root, null, {}), "");
    assert.equal(readProjectProfileState(root).active, null);
  } finally {
    cleanupTempProject(root);
  }
});

test("a setting change re-renders the prompt AND the routines", () => {
  installFixture();
  const root = makeTempProject({ name: "settings" });
  try {
    useProjectProfile(projectOf(root), "acme");
    setProjectProfileConfig(projectOf(root), { weekly_deliveries: 9 });
    assert.match(buildProjectProfileBlock(root, null, {}), /Cap: 9/);
    assert.equal(listRoutines(projectStorageRoot(apxIdOf(root))).length, 1, "still exactly one, re-synced not duplicated");
  } finally {
    cleanupTempProject(root);
  }
});

test("standing it down disables its routines without deleting them", () => {
  installFixture();
  const root = makeTempProject({ name: "off" });
  try {
    useProjectProfile(projectOf(root), "acme");
    const out = offProjectProfile(projectOf(root));
    assert.deepEqual(out.disabled, ["acme-pulse"]);
    assert.equal(readProjectProfileState(root).active, null);

    const [routine] = listRoutines(projectStorageRoot(apxIdOf(root)));
    assert.equal(routine.name, "acme-pulse");
    assert.equal(routine.enabled, false, "disabled, never deleted — the user may have edited it");
  } finally {
    cleanupTempProject(root);
  }
});

test("removing it drops the routines it installed untouched", () => {
  installFixture();
  const root = makeTempProject({ name: "remove" });
  try {
    useProjectProfile(projectOf(root), "acme");
    removeProjectProfile(projectOf(root));
    assert.deepEqual(listRoutines(projectStorageRoot(apxIdOf(root))), []);
  } finally {
    cleanupTempProject(root);
  }
});

test("a project package is refused on the super-agent, and vice versa", () => {
  installFixture();
  installFixture("boss", { scope: "super-agent" });
  const root = makeTempProject({ name: "scopes" });
  try {
    assert.throws(() => useProfile("acme"), /belongs to a project/);
    assert.throws(() => useProjectProfile(projectOf(root), "boss"), /belongs to the super-agent/);
  } finally {
    cleanupTempProject(root);
  }
});

test("two profiles cannot run on one project at the same time", () => {
  installFixture();
  installFixture("other");
  const root = makeTempProject({ name: "one-at-a-time" });
  try {
    useProjectProfile(projectOf(root), "acme");
    assert.throws(() => useProjectProfile(projectOf(root), "other"), /already active on this project/);
    useProjectProfile(projectOf(root), "other", { confirmReplace: true });
    assert.equal(readProjectProfileState(root).active, "other");

    const routines = listRoutines(projectRoutineStorage(projectOf(root)));
    assert.equal(routines.find((r) => r.name === "acme-pulse").enabled, false, "the outgoing one stands down");
    assert.equal(routines.find((r) => r.name === "other-pulse").enabled, true);
  } finally {
    cleanupTempProject(root);
  }
});
