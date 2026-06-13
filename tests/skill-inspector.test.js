// Unit tests for the Skill Inspector + persistent index.
//
// The inspector + index can both work fully offline thanks to the TF fallback
// in core/memory/embeddings.js, so these tests don't need network, GPU, or
// API keys — they're representative of the experience a user gets out of the
// box.
//
// Strategy: install a project-scoped skill with a distinctive description in
// a temp dir, then probe the inspector with prompts that should and should
// not match it.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  inspectPromptForSkills,
  isInspectorEnabled,
  INSPECTOR_DEFAULTS,
} from "#core/agent/skills/inspector.js";
import {
  ensureIndex,
  planIndex,
  readIndex,
  clearIndex,
} from "#core/agent/skills/index-store.js";
import { listSkills } from "#core/agent/skills/loader.js";
import { clearSkillVectorCache } from "#core/agent/skills/rag.js";

// Distinctive nonsense vocabulary so neither builtin skills nor random TF
// overlap can compete with our fixture. The slug is randomised per process
// so a stale ~/.apx/skills/apx-rag-demo/ left behind by a manual probe can't
// shadow the project fixture and silently break the "removed → pruned" test.
const FIXTURE_SLUG = `apx-rag-test-${process.pid}`;
const FIXTURE_DESC =
  "Boondiggle and frangistan helper — manage frabjous widgets, calibrate the snorkleflox, and rotate the borogrove buffer.";
const FIXTURE_BODY = "# apx-rag-demo\n\nCall `boondiggle frangistan` to start.\n";

async function withFixtureProject(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-inspector-"));
  const skillDir = path.join(dir, ".apc", "skills", FIXTURE_SLUG);
  fs.mkdirSync(skillDir, { recursive: true });
  const md = `---\nname: ${FIXTURE_SLUG}\ndescription: ${FIXTURE_DESC}\n---\n\n${FIXTURE_BODY}`;
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), md);
  // The inspector reads from a global index file at ~/.apx/skills/.index.json.
  // We clear it between tests so a previous run doesn't contaminate results.
  clearIndex();
  clearSkillVectorCache();
  try {
    return await fn(dir);
  } finally {
    clearIndex();
    clearSkillVectorCache();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const enabledConfig = {
  skills: { inspector: { ...INSPECTOR_DEFAULTS, enabled: true, hint_threshold: 0.05, load_threshold: 0.15, margin: 0.0 } },
  memory: { embeddings: { provider: "tf" } },
};

test("isInspectorEnabled: false by default, true when config flag is on", () => {
  assert.equal(isInspectorEnabled({}), false);
  assert.equal(isInspectorEnabled({ skills: { inspector: { enabled: true } } }), true);
});

test("inspectPromptForSkills returns disabled trace when feature off", async () => {
  const out = await inspectPromptForSkills({
    prompt: "boondiggle frangistan time",
    globalConfig: { skills: { inspector: { enabled: false } } },
  });
  assert.equal(out.contextNote, "");
  assert.equal(out.trace.enabled, false);
  assert.equal(out.trace.reason, "disabled");
});

test("inspectPromptForSkills skips very short prompts even when enabled", async () => {
  const out = await inspectPromptForSkills({
    prompt: "ok",
    globalConfig: enabledConfig,
  });
  assert.equal(out.contextNote, "");
  assert.equal(out.trace.reason, "prompt_too_short");
});

test("inspectPromptForSkills: matching prompt injects the fixture skill body (JIT path, no index)", async () => {
  await withFixtureProject(async (projectPath) => {
    // Confirm the fixture is actually discoverable before measuring the
    // inspector — otherwise a failure here would be ambiguous.
    const skills = listSkills({ projectPath });
    assert.ok(skills.some((s) => s.slug === FIXTURE_SLUG), "fixture must be discoverable");

    const out = await inspectPromptForSkills({
      prompt: "I need help with boondiggle frangistan frabjous widgets right now",
      projectPath,
      globalConfig: enabledConfig,
    });
    assert.equal(out.trace.enabled, true);
    // Either the body got inlined (load) or a hint was emitted; in both cases
    // the slug must appear in the trace and the contextNote.
    const surfaced = (out.trace.loaded || []).concat(out.trace.hinted || []);
    assert.ok(surfaced.includes(FIXTURE_SLUG), `expected ${FIXTURE_SLUG} to be surfaced, got ${JSON.stringify(out.trace)}`);
    assert.ok(out.contextNote.includes("Skill Inspector"));
    assert.ok(out.contextNote.includes(FIXTURE_SLUG));
  });
});

test("inspectPromptForSkills: unrelated prompt does NOT surface the fixture (natural decay)", async () => {
  await withFixtureProject(async (projectPath) => {
    const out = await inspectPromptForSkills({
      prompt: "rebase this branch onto main and resolve conflicts in package.json",
      projectPath,
      // Use the actual production thresholds — the lax test config above would
      // surface ANY skill above sim 0.05, defeating the purpose of this test.
      globalConfig: {
        skills: { inspector: { ...INSPECTOR_DEFAULTS, enabled: true } },
        memory: { embeddings: { provider: "tf" } },
      },
    });
    const surfaced = (out.trace.loaded || []).concat(out.trace.hinted || []);
    assert.ok(!surfaced.includes(FIXTURE_SLUG), `nonsense-vocab fixture must not match a git prompt (got ${JSON.stringify(out.trace)})`);
  });
});

test("inspectPromptForSkills: never throws on empty/null input", async () => {
  const r1 = await inspectPromptForSkills({ prompt: "", globalConfig: enabledConfig });
  assert.equal(r1.contextNote, "");
  const r2 = await inspectPromptForSkills({ prompt: null, globalConfig: enabledConfig });
  assert.equal(r2.contextNote, "");
});

// ---------------------------------------------------------------------------
// Index store
// ---------------------------------------------------------------------------

test("planIndex: classifies missing/existing/gone correctly", async () => {
  await withFixtureProject(async (projectPath) => {
    const plan1 = planIndex({ projectPath });
    assert.ok(plan1.missing.includes(FIXTURE_SLUG), "fixture should be missing before first index");

    await ensureIndex({ projectPath, embedOpts: { provider: "tf" } });

    const plan2 = planIndex({ projectPath, currentEmbedder: "tf" });
    assert.ok(!plan2.missing.includes(FIXTURE_SLUG), "fixture should be present after indexing");
    assert.ok(plan2.existing.includes(FIXTURE_SLUG) || plan2.stale.includes(FIXTURE_SLUG),
      "fixture should be either existing or stale (mtime quirks on some FS)");
  });
});

test("ensureIndex: writes a persistent file with embedder tag and dim", async () => {
  await withFixtureProject(async (projectPath) => {
    const result = await ensureIndex({ projectPath, embedOpts: { provider: "tf" } });
    assert.equal(result.embedder, "tf");
    assert.ok(result.dim > 0);
    assert.ok(result.items[FIXTURE_SLUG], "fixture must be in the index");
    assert.ok(Array.isArray(result.items[FIXTURE_SLUG].desc_vector));

    const onDisk = readIndex();
    assert.equal(onDisk.embedder, "tf");
    assert.ok(onDisk.items[FIXTURE_SLUG]);
  });
});

test("ensureIndex: drops removed skills on next pass", async () => {
  await withFixtureProject(async (projectPath) => {
    await ensureIndex({ projectPath, embedOpts: { provider: "tf" } });
    assert.ok(readIndex().items[FIXTURE_SLUG]);

    // Remove the fixture file and re-index — it should be pruned.
    fs.rmSync(path.join(projectPath, ".apc", "skills", FIXTURE_SLUG), { recursive: true, force: true });
    const result = await ensureIndex({ projectPath, embedOpts: { provider: "tf" } });
    assert.ok(!result.items[FIXTURE_SLUG], "removed fixture should be pruned from the index");
    assert.ok(result.changed.removed.includes(FIXTURE_SLUG));
  });
});
