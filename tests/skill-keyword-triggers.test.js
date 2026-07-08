// Unit tests for keyword-triggered skills ("option B", OpenHands-style):
//   - frontmatter `triggers:` list parsing (inline + dash-list) in loader.js
//   - matchSkillKeywordTriggers() gating, ordering, caps, and contextNote shape
//   - GET/PUT /skills/keyword-triggers daemon routes
//
// Offline by design: everything runs against temp project trees and a temp
// HOME so the real ~/.apx is never touched.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Per-test APX home BEFORE importing anything that resolves ~/.apx paths.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-kw-triggers-"));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

const { listSkills, loadSkill } = await import("#core/agent/skills/loader.js");
const { matchSkillKeywordTriggers, areKeywordTriggersEnabled, KEYWORD_TRIGGER_DEFAULTS } =
  await import("#core/agent/skills/trigger.js");
const { ProjectManager } = await import("#host/daemon/db.js");
const { buildApi } = await import("#host/daemon/api.js");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProject(skills) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-kw-proj-"));
  const base = path.join(dir, ".apc", "skills");
  for (const s of skills) {
    const skillDir = path.join(base, s.slug);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), s.raw);
  }
  return dir;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function enabledConfig(extra = {}) {
  return { skills: { keyword_triggers: { enabled: true, ...extra } } };
}

const INLINE_SKILL = {
  slug: "deploy-helper",
  raw: [
    "---",
    "name: deploy-helper",
    "description: Deploy workflow helper.",
    "triggers: [deploy, release, ship it]",
    "---",
    "",
    "# Deploy helper",
    "Run the deploy pipeline.",
  ].join("\n"),
};

const DASH_SKILL = {
  slug: "db-migrate",
  raw: [
    "---",
    "name: db-migrate",
    "description: Database migration helper.",
    "triggers:",
    "  - migration",
    "  - schema change",
    "---",
    "",
    "# DB migrate",
    "Migration steps here.",
  ].join("\n"),
};

// ---------------------------------------------------------------------------
// Frontmatter list parsing
// ---------------------------------------------------------------------------

test("frontmatter: inline triggers list is parsed into an array", () => {
  const proj = makeProject([INLINE_SKILL]);
  try {
    const entry = listSkills({ projectPath: proj }).find((s) => s.slug === "deploy-helper");
    assert.ok(entry);
    assert.deepEqual(entry.triggers, ["deploy", "release", "ship it"]);
    // Scalars must keep working exactly as before (no regression).
    assert.equal(entry.description, "Deploy workflow helper.");
  } finally {
    cleanup(proj);
  }
});

test("frontmatter: dash-list triggers are parsed into an array", () => {
  const proj = makeProject([DASH_SKILL]);
  try {
    const loaded = loadSkill("db-migrate", { projectPath: proj });
    assert.deepEqual(loaded.triggers, ["migration", "schema change"]);
    assert.equal(loaded.description, "Database migration helper.");
    assert.match(loaded.body, /Migration steps here\./);
  } finally {
    cleanup(proj);
  }
});

test("frontmatter: skills without triggers expose an empty array", () => {
  const proj = makeProject([
    { slug: "plain", raw: "---\nname: plain\ndescription: No triggers here.\n---\n\nBody." },
  ]);
  try {
    const entry = listSkills({ projectPath: proj }).find((s) => s.slug === "plain");
    assert.deepEqual(entry.triggers, []);
    const loaded = loadSkill("plain", { projectPath: proj });
    assert.deepEqual(loaded.triggers, []);
    assert.equal(loaded.description, "No triggers here.");
  } finally {
    cleanup(proj);
  }
});

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

test("disabled config → no matches even when a keyword is present", () => {
  const proj = makeProject([INLINE_SKILL]);
  try {
    assert.equal(areKeywordTriggersEnabled({}), false);
    const r = matchSkillKeywordTriggers("please deploy this", { projectPath: proj, config: {} });
    assert.deepEqual(r.matched, []);
    assert.equal(r.contextNote, undefined);
  } finally {
    cleanup(proj);
  }
});

test("case-insensitive substring match injects the skill body", () => {
  const proj = makeProject([INLINE_SKILL]);
  try {
    const r = matchSkillKeywordTriggers("Time to DEPLOY the new build", {
      projectPath: proj,
      config: enabledConfig(),
    });
    assert.equal(r.matched.length, 1);
    assert.deepEqual(r.matched[0], { slug: "deploy-helper", keyword: "deploy", source: "project" });
    assert.match(r.contextNote, /# Skill auto-activated by keyword: `deploy-helper` \(matched "deploy"\)/);
    assert.match(r.contextNote, /Don't re-call load_skill/);
    assert.match(r.contextNote, /Run the deploy pipeline\./);
  } finally {
    cleanup(proj);
  }
});

test("multi-word keyword matches as a substring", () => {
  const proj = makeProject([DASH_SKILL]);
  try {
    const r = matchSkillKeywordTriggers("we need a schema change for users", {
      projectPath: proj,
      config: enabledConfig(),
    });
    assert.equal(r.matched.length, 1);
    assert.equal(r.matched[0].keyword, "schema change");
  } finally {
    cleanup(proj);
  }
});

test("keywords shorter than 3 chars are ignored", () => {
  const proj = makeProject([
    {
      slug: "shorty",
      raw: "---\nname: shorty\ntriggers: [ok, zx, gitops]\n---\n\nShorty body.",
    },
  ]);
  try {
    const none = matchSkillKeywordTriggers("ok zx", { projectPath: proj, config: enabledConfig() });
    assert.deepEqual(none.matched, []);
    const hit = matchSkillKeywordTriggers("set up gitops please", {
      projectPath: proj,
      config: enabledConfig(),
    });
    assert.equal(hit.matched.length, 1);
    assert.equal(hit.matched[0].keyword, "gitops");
  } finally {
    cleanup(proj);
  }
});

test("max_matches caps how many skills are injected (alphabetical within source)", () => {
  const proj = makeProject([
    { slug: "aaa", raw: "---\nname: aaa\ntriggers: [widget]\n---\n\nA body." },
    { slug: "bbb", raw: "---\nname: bbb\ntriggers: [widget]\n---\n\nB body." },
    { slug: "ccc", raw: "---\nname: ccc\ntriggers: [widget]\n---\n\nC body." },
  ]);
  try {
    const r = matchSkillKeywordTriggers("configure the widget now", {
      projectPath: proj,
      config: enabledConfig({ max_matches: 2 }),
    });
    assert.deepEqual(r.matched.map((m) => m.slug), ["aaa", "bbb"]);
  } finally {
    cleanup(proj);
  }
});

test("disabled skill (policy) is never keyword-injected", () => {
  const proj = makeProject([INLINE_SKILL]);
  try {
    const config = {
      skills: {
        keyword_triggers: { enabled: true },
        policy: { [proj]: { "deploy-helper": false } },
      },
    };
    const r = matchSkillKeywordTriggers("deploy this", { projectPath: proj, config });
    assert.deepEqual(r.matched, []);
  } finally {
    cleanup(proj);
  }
});

test("body_char_cap truncates long bodies", () => {
  const longBody = "X".repeat(500);
  const proj = makeProject([
    { slug: "long", raw: `---\nname: long\ntriggers: [longword]\n---\n\n${longBody}` },
  ]);
  try {
    const r = matchSkillKeywordTriggers("longword", {
      projectPath: proj,
      config: enabledConfig({ body_char_cap: 100 }),
    });
    assert.equal(r.matched.length, 1);
    assert.match(r.contextNote, /truncated — call load_skill/);
    assert.ok(!r.contextNote.includes("X".repeat(101)));
  } finally {
    cleanup(proj);
  }
});

test("non-string / empty message → no matches", () => {
  assert.deepEqual(matchSkillKeywordTriggers(null, { config: enabledConfig() }).matched, []);
  assert.deepEqual(matchSkillKeywordTriggers("   ", { config: enabledConfig() }).matched, []);
});

// ---------------------------------------------------------------------------
// Daemon routes
// ---------------------------------------------------------------------------

async function listen(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

function makeApp() {
  const projects = new ProjectManager({});
  const plugins = { instances: new Map(), get: () => null, status: () => ({}) };
  return buildApi({
    projects,
    registries: null,
    plugins,
    scheduler: null,
    version: "test",
    startedAt: Date.now(),
    addProjectGlobally: () => {},
    config: { host: "127.0.0.1", port: 7430 },
    token: "",
  });
}

test("GET/PUT /skills/keyword-triggers round-trip config through ~/.apx", async () => {
  const { server, baseUrl } = await listen(makeApp());
  try {
    let res = await fetch(`${baseUrl}/skills/keyword-triggers`);
    assert.equal(res.status, 200);
    let body = await res.json();
    assert.equal(body.config.enabled, false);
    assert.equal(body.config.max_matches, KEYWORD_TRIGGER_DEFAULTS.max_matches);
    assert.equal(body.config.body_char_cap, KEYWORD_TRIGGER_DEFAULTS.body_char_cap);
    assert.deepEqual(body.keys.sort(), ["body_char_cap", "enabled", "max_matches"]);
    assert.ok(Array.isArray(body.skills));

    res = await fetch(`${baseUrl}/skills/keyword-triggers`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, max_matches: 3, unknown_key: "ignored" }),
    });
    assert.equal(res.status, 200);
    body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.config.enabled, true);
    assert.equal(body.config.max_matches, 3);
    assert.equal(body.config.unknown_key, undefined);

    // Persisted: a fresh GET reflects the PUT.
    res = await fetch(`${baseUrl}/skills/keyword-triggers`);
    body = await res.json();
    assert.equal(body.config.enabled, true);
    assert.equal(body.config.max_matches, 3);

    // And the on-disk config under the temp HOME actually holds it.
    const disk = JSON.parse(fs.readFileSync(path.join(tmpHome, ".apx", "config.json"), "utf8"));
    assert.equal(disk.skills.keyword_triggers.enabled, true);
    assert.equal(disk.skills.keyword_triggers.max_matches, 3);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("GET /skills/keyword-triggers lists skills that declare triggers", async () => {
  const proj = makeProject([INLINE_SKILL, { slug: "plain", raw: "---\nname: plain\n---\n\nBody." }]);
  const { server, baseUrl } = await listen(makeApp());
  try {
    const res = await fetch(
      `${baseUrl}/skills/keyword-triggers?project_path=${encodeURIComponent(proj)}`,
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    const declared = body.skills.find((s) => s.slug === "deploy-helper");
    assert.ok(declared, "deploy-helper should be listed");
    assert.deepEqual(declared.triggers, ["deploy", "release", "ship it"]);
    assert.equal(body.skills.some((s) => s.slug === "plain"), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    cleanup(proj);
  }
});
