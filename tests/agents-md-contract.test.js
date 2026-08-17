// AGENTS.md is the contract coding agents read before touching this repo.
// A wrong path in it is worse than no path: it actively sends an agent to the
// wrong file, and the survey found six of them — including two on lines the
// file itself labels "Footgun". This test makes rule "paths are verified" real.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AGENTS_MD = path.join(REPO, "AGENTS.md");

const text = fs.readFileSync(AGENTS_MD, "utf8");

// Pull every `backticked` span, then keep the ones that look like a repo path:
// they contain a slash and end in a known source extension, or name a directory
// under a known root. Prose like `provider:model` or `{ error }` is skipped.
const SOURCE_EXT = /\.(js|ts|tsx|md|mdx|json|mjs)$/;
const ROOTS = ["src/", "tests/", "scripts/", "skills/", "docs/", ".github/"];
// `.apc/…` names per-project runtime state that only exists once a project is
// scaffolded — it is a convention, not a file in this repo.
const CONVENTION_PREFIXES = [".apc/"];

function candidatePaths(md) {
  const spans = md.match(/`[^`\n]+`/g) || [];
  const out = new Set();
  for (const raw of spans) {
    const s = raw.slice(1, -1).trim();
    if (!s.includes("/")) continue;
    if (s.includes(" ") || s.includes("*") || s.includes("<") || s.includes("|")) continue;
    if (s.startsWith("http") || s.startsWith("~") || s.startsWith("#")) continue;
    // Route paths (/api/...) and provider ids are not files.
    if (s.startsWith("/")) continue;
    if (CONVENTION_PREFIXES.some((c) => s.startsWith(c))) continue;
    const isUnderRoot = ROOTS.some((r) => s.startsWith(r));
    if (!isUnderRoot && !SOURCE_EXT.test(s)) continue;
    if (!isUnderRoot && !s.startsWith("src/")) continue;
    out.add(s.replace(/\/$/, ""));
  }
  return [...out];
}

test("AGENTS.md: every repo path it names exists", () => {
  const missing = candidatePaths(text).filter(
    (p) => !fs.existsSync(path.join(REPO, p))
  );
  assert.deepEqual(
    missing,
    [],
    `AGENTS.md points at paths that do not exist:\n  ${missing.join("\n  ")}`
  );
});

// The survey found AGENTS.md contradicting itself on the agent's display name
// ("Superagente" in one section, rule 4 saying the default is "APX") while the
// code said a third thing. Pin it to the code.
test("AGENTS.md: identity fallback matches the code", async () => {
  const { SUPERAGENT_DISPLAY_FALLBACK } = await import(
    "../src/core/identity/self.js"
  );
  assert.match(
    text,
    new RegExp(`SUPERAGENT_DISPLAY_FALLBACK[^\\n]*"${SUPERAGENT_DISPLAY_FALLBACK}"`),
    "the Desktop section must name the real fallback constant and value"
  );
  assert.ok(
    !/"Superagente"/.test(text),
    'stale literal "Superagente" is back in AGENTS.md'
  );
});

// Rule 12 points at the prompt that ships on every turn. If the prompts tree is
// reorganized again, this fails instead of silently misdirecting.
test("AGENTS.md: named prompt files resolve", () => {
  for (const rel of [
    "src/core/agent/prompts/core/super-agent.md",
    "src/core/agent/prompts/discipline/action.md",
  ]) {
    assert.ok(fs.existsSync(path.join(REPO, rel)), `${rel} must exist`);
    const base = rel.split("/").slice(-2).join("/");
    assert.ok(text.includes(base), `AGENTS.md should reference ${base}`);
  }
});

// Rule 9 used to warn about a hand-maintained `API_PREFIXES` list. The /api
// cutover deleted that list and made the seam structural, so the warning is
// obsolete — and an obsolete footgun sends agents hunting for a file that no
// longer exists. Pin the rule to the mechanism that actually ships.
test("AGENTS.md: the route rule describes the real /api seam", () => {
  const prefixSrc = fs.readFileSync(
    path.join(REPO, "src/host/daemon/api/prefix.js"),
    "utf8"
  );
  assert.match(prefixSrc, /export const API_PREFIX\s*=\s*"\/api"/);
  assert.match(prefixSrc, /export function isApiPath/);

  const rule = text.split("\n").find((l) => l.includes("Adding a daemon route"));
  assert.ok(rule, "rule 9 should exist");
  assert.ok(
    rule.includes("api/prefix.js"),
    "rule 9 must point at the module that owns the seam"
  );
  assert.ok(
    !/add the path prefix to `API_PREFIXES`/.test(text),
    "the obsolete API_PREFIXES footgun is back in AGENTS.md"
  );
});

// Guards the seam itself: nothing should reintroduce a second hand-maintained
// prefix list now that /api makes the answer structural.
test("no hand-maintained API prefix list has crept back in", () => {
  const apiDir = path.join(REPO, "src/host/daemon/api");
  const offenders = fs
    .readdirSync(apiDir)
    .filter((f) => f.endsWith(".js"))
    .filter((f) =>
      /API_PREFIXES\s*=/.test(fs.readFileSync(path.join(apiDir, f), "utf8"))
    );
  assert.deepEqual(offenders, [], "use isApiPath() from api/prefix.js instead");
});

// ---------------------------------------------------------------------------
// README — the first thing a human or an agent reads, and it had drifted hard:
// its channel table listed four names of which only one existed, and it gave
// an example command using a channel that never has.
// ---------------------------------------------------------------------------

const README = fs.readFileSync(path.join(REPO, "README.md"), "utf8");

test("README: the channel table matches core/constants/channels.js", async () => {
  const { CHANNELS } = await import("#core/constants/channels.js");
  const real = new Set(Object.values(CHANNELS));

  const table = README.split("| Channel | What it captures |")[1] || "";
  const listed = [...table.split("\n## ")[0].matchAll(/^\|\s*`([a-z_]+)`/gm)].map(
    (m) => m[1]
  );
  assert.ok(listed.length > 0, "channel table not found");

  const bogus = listed.filter((c) => !real.has(c));
  assert.deepEqual(bogus, [], "README lists channels that do not exist");

  // `voice` is a mode, not a channel — the distinction is load-bearing.
  assert.ok(!listed.includes("voice"), "voice is a mode, not a channel");
});

test("README: the runtimes table matches the registry", async () => {
  const { RUNTIME_IDS } = await import("#core/runtimes/index.js");
  const table = README.split("## Runtimes")[1] || "";
  const listed = [...table.matchAll(/^\|\s*`([a-z-]+)`/gm)].map((m) => m[1]);
  const missing = [...RUNTIME_IDS].filter((r) => !listed.includes(r));
  assert.deepEqual(missing, [], "README omits shipped runtimes");
});

test("README: the Node version matches package.json engines", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
  const major = pkg.engines.node.replace(/[^\d.]/g, "").split(".")[0];
  assert.match(
    README,
    new RegExp(`Node\\.js ${major}\\+`),
    `README should say Node.js ${major}+ to match engines.node`
  );
});

// Rule 4: "super-agent" is a mode, not a persona name.
test("README does not reintroduce a persona name for the super-agent", () => {
  assert.ok(!/\bRoby\b/.test(README), "the super-agent has no persona name");
});
