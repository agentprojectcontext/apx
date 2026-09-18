// Two things this file pins down, both of which were broken at once and hid
// each other:
//
//   1. THE DRY RUN. The settings panel can now ask "which skills would this
//      message pull in?" and get a per-skill verdict back. It has to be the
//      SAME scoring the live turn does, and it has to name the gate that
//      dropped each skill — "matched but below the bar" is unreadable when the
//      two gates (raw similarity, relevance over the skill's own baseline) are
//      collapsed into one number.
//
//   2. THE SURFACES. The per-turn skill RAG lived in the daemon's two HTTP
//      handlers only. Telegram and WhatsApp call runSuperAgent() directly, so
//      on those channels it never ran: no injection, no suggestion, no trace.
//      A question answered on the web had the matching skill in its prompt and
//      the same question on Telegram did not, which reads from the outside as
//      the agent having lost a capability.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// APX_HOME before any import that reaches core/config/paths.js — it resolves
// SKILLS_INDEX_PATH once, at import time, and without this the run would score
// against (and clear) the real ~/.apx skill index. AGENTS.md rule 1.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-turn-skills-home-"));
process.env.APX_HOME = path.join(tmpHome, ".apx");
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;
fs.mkdirSync(process.env.APX_HOME, { recursive: true });

const {
  explainPromptForSkills,
  shouldKeepSkillsHint,
  INSPECTOR_DEFAULTS,
} = await import("#core/agent/skills/inspector.js");
const { resolveTurnSkills, mergeContextNote } = await import("#core/agent/skills/turn-skills.js");
const { clearIndex } = await import("#core/agent/skills/index-store.js");
const { clearSkillVectorCache } = await import("#core/agent/skills/rag.js");

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Nonsense vocabulary so no bundled skill can compete with the fixture.
const SLUG = `apx-probe-test-${process.pid}`;
const DESC =
  "Snorkleflox calibration — rotate the borogrove buffer, tune a frangistan coil, and re-seat frabjous widgets.";

function withFixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-probe-"));
  const skillDir = path.join(dir, ".apc", "skills", SLUG);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${SLUG}\ndescription: ${DESC}\n---\n\n# ${SLUG}\n\nRun \`snorkleflox calibrate\` first.\n`,
  );
  clearIndex();
  clearSkillVectorCache();
  return Promise.resolve(fn(dir)).finally(() => {
    clearIndex();
    clearSkillVectorCache();
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

const offlineCfg = (over = {}) => ({
  skills: { inspector: { ...INSPECTOR_DEFAULTS, ...over } },
  memory: { embeddings: { provider: "tf" } },
});

// ── 1. The dry run ──────────────────────────────────────────────────────────

test("explain: reports the real enabled flag but scores anyway (you test it to decide)", async () => {
  await withFixture(async (projectPath) => {
    const out = await explainPromptForSkills({
      prompt: "calibrate the snorkleflox and rotate the borogrove buffer please",
      projectPath,
      globalConfig: offlineCfg({ enabled: false }),
    });
    assert.equal(out.enabled, false, "must report the inspector is OFF");
    assert.ok(out.candidates.length > 0, "and still score, or the tester is useless");
  });
});

test("explain: a matching prompt names the skill and marks it injected/suggested", async () => {
  await withFixture(async (projectPath) => {
    const out = await explainPromptForSkills({
      prompt: "calibrate the snorkleflox and rotate the borogrove buffer please",
      projectPath,
      globalConfig: offlineCfg({ enabled: true }),
    });
    const mine = out.candidates.find((c) => c.slug === SLUG);
    assert.ok(mine, `fixture must be scored, got ${out.candidates.map((c) => c.slug).join(",")}`);
    assert.ok(["loaded", "hinted"].includes(mine.verdict), `expected a hit, got ${mine.verdict}`);
    assert.ok(out.loaded.concat(out.hinted).includes(SLUG));
  });
});

test("explain: a skill under the raw floor reads 'unrelated', not 'weak'", async () => {
  await withFixture(async (projectPath) => {
    // raw_floor at 1.0 is unreachable, so EVERY candidate is dropped by that
    // gate. This is the exact shape of the live bug: skills standing well above
    // their own baseline (rel over the bar) thrown out by the similarity floor
    // before ranking, with nothing in the UI saying which gate did it.
    const out = await explainPromptForSkills({
      prompt: "calibrate the snorkleflox and rotate the borogrove buffer please",
      projectPath,
      globalConfig: offlineCfg({ enabled: true, raw_floor: 1.0, hint_z: 0 }),
    });
    assert.deepEqual(out.loaded, []);
    assert.deepEqual(out.hinted, []);
    assert.ok(out.candidates.every((c) => c.verdict === "unrelated"),
      "every candidate must name the similarity floor as the reason");
  });
});

test("explain: thresholds and the embedder come back so the UI can show the bar", async () => {
  await withFixture(async (projectPath) => {
    const out = await explainPromptForSkills({
      prompt: "calibrate the snorkleflox please",
      projectPath,
      globalConfig: offlineCfg({ enabled: true }),
    });
    assert.equal(out.thresholds.raw_floor, INSPECTOR_DEFAULTS.raw_floor);
    assert.equal(out.thresholds.hint_z, INSPECTOR_DEFAULTS.hint_z);
    assert.equal(out.embedder, "tf");
    // The offline embedder matches literal tokens only. Say so, loudly: these
    // numbers are not comparable to a real embedding model's.
    assert.equal(out.degraded, true);
  });
});

test("explain: a prompt under the floor is reported, not scored", async () => {
  const out = await explainPromptForSkills({ prompt: "ok", globalConfig: offlineCfg({ enabled: true }) });
  assert.equal(out.reason, "prompt_too_short");
  assert.deepEqual(out.candidates, []);
});

// ── 2. The catalog guardrail ────────────────────────────────────────────────

test("shouldKeepSkillsHint: the static catalog survives a blind embedder", () => {
  // Nothing injected AND the offline floor answered → the agent would be left
  // with no catalog and no RAG. That is the state that made a live install say
  // "I have no tool for that" about a skill it had.
  assert.equal(shouldKeepSkillsHint({ enabled: true, embedder: "tf", degraded: true, loaded: [], hinted: [] }), true);
  // A real embedder that looked and found nothing IS the feature working.
  assert.equal(shouldKeepSkillsHint({ enabled: true, embedder: "ollama:nomic-embed-text", loaded: [], hinted: [] }), false);
  // Something was injected → the catalog's job is done.
  assert.equal(shouldKeepSkillsHint({ enabled: true, embedder: "tf", degraded: true, hinted: ["x"] }), false);
  // Inspector off → nothing changes.
  assert.equal(shouldKeepSkillsHint({ enabled: false }), true);
  assert.equal(shouldKeepSkillsHint(null), true);
});

// ── 3. One decision, every surface ──────────────────────────────────────────

test("resolveTurnSkills: inspector on → note + trace + the catalog call", async () => {
  await withFixture(async (projectPath) => {
    const out = await resolveTurnSkills({
      prompt: "calibrate the snorkleflox and rotate the borogrove buffer please",
      projectPath,
      globalConfig: offlineCfg({ enabled: true }),
    });
    assert.ok(out.contextNote.includes(SLUG), "the matched skill must reach the prompt");
    assert.equal(out.trace.enabled, true);
    assert.equal(typeof out.skipSkillsHint, "boolean");
  });
});

test("resolveTurnSkills: inspector off → passive nudge, catalog untouched", async () => {
  await withFixture(async (projectPath) => {
    const out = await resolveTurnSkills({
      prompt: "calibrate the snorkleflox and rotate the borogrove buffer please",
      projectPath,
      globalConfig: offlineCfg({ enabled: false }),
    });
    assert.equal(out.trace, null);
    assert.equal(out.skipSkillsHint, false, "with the inspector off the slug dump must stay");
  });
});

test("resolveTurnSkills: an empty prompt costs nothing and changes nothing", async () => {
  const out = await resolveTurnSkills({ prompt: "   ", globalConfig: offlineCfg({ enabled: true }) });
  assert.equal(out.contextNote, "");
  assert.equal(out.trace, null);
  assert.equal(out.skipSkillsHint, false);
});

test("mergeContextNote: keeps both halves, drops the empty one", () => {
  assert.equal(mergeContextNote("a", "b"), "a\n\nb");
  assert.equal(mergeContextNote("", "b"), "b");
  assert.equal(mergeContextNote("a", ""), "a");
});

// A source-level gate, because the regression is an OMISSION: a channel that
// runs a tool-using turn without asking for skills first looks completely
// normal in every behavioural test — it just quietly answers with a smaller
// prompt than the web does. The import is the cheapest thing that cannot be
// forgotten silently.
test("every tool-using surface resolves skills for the turn", () => {
  const surfaces = [
    "src/host/daemon/api/super-agent.js",
    "src/core/channels/telegram/reply.js",
    "src/core/channels/whatsapp/dispatch.js",
  ];
  for (const rel of surfaces) {
    const src = fs.readFileSync(path.join(REPO, rel), "utf8");
    assert.match(src, /resolveTurnSkills/,
      `${rel} runs a super-agent turn: it must resolve the turn's skills (core/agent/skills/turn-skills.js)`);
  }
});
