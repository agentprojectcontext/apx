// Profile lifecycle: install / use / off / config / doctor / uninstall.
// Covers tests 4-7 of docs-internal/secretary/01-SPEC-profiles.md § 9.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-profile-life-"));
process.env.HOME = TMP_HOME;

const {
  installProfile,
  useProfile,
  offProfile,
  setProfileConfig,
  uninstallProfile,
  profileDoctor,
  listProfilesWithState,
  resolveInstallSource,
  estimateTokens,
} = await import("#core/profiles/lifecycle.js");
const { readConfig, writeConfig } = await import("#core/config/index.js");
const { listRoutines, upsertRoutine } = await import("#core/stores/routines.js");
const { projectStorageRoot, DEFAULT_PROJECT_ID } = await import("#core/config/paths.js");
const { PROFILES_DIR } = await import("#core/profiles/paths.js");

const SA_STORAGE = projectStorageRoot(DEFAULT_PROJECT_ID);

// --------------------------------------------------------------------------
// helpers
// --------------------------------------------------------------------------

let seq = 0;

/** Build a profile package in a scratch dir, ready to install by path. */
function makePackage({
  id = `p${++seq}`,
  prompt = "# Role: Tester\nOwner {{owner_name}}. Opens at {{day_open_at}}.",
  manifest = {},
  schema = {
    type: "object",
    properties: {
      day_open_at: { type: "string", default: "08:30" },
      nudge_budget_per_day: { type: "integer", default: 3 },
      formality: { type: "string", enum: ["tu", "vos", "neutral"], default: "neutral" },
    },
  },
  routines = null,
} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `apx-pkg-${id}-`));
  fs.writeFileSync(
    path.join(dir, "profile.json"),
    JSON.stringify({ id, name: id, version: "1.0.0", ...manifest }, null, 2)
  );
  fs.writeFileSync(path.join(dir, "PROFILE.md"), prompt);
  if (schema) {
    fs.writeFileSync(path.join(dir, "config.schema.json"), JSON.stringify(schema, null, 2));
  }
  if (routines) {
    const rdir = path.join(dir, "routines");
    fs.mkdirSync(rdir);
    for (const [name, body] of Object.entries(routines)) {
      fs.writeFileSync(path.join(rdir, `${name}.json`), JSON.stringify(body, null, 2));
    }
  }
  return { id, dir };
}

function resetState() {
  const cfg = readConfig();
  delete cfg.profile;
  writeConfig(cfg);
  fs.rmSync(PROFILES_DIR, { recursive: true, force: true });
  fs.rmSync(path.join(SA_STORAGE, "routines.json"), { force: true });
}

const DAY_OPEN_ROUTINE = {
  name: "day-open",
  kind: "super_agent",
  schedule: "cron:{{day_open_at}}",
  spec: { prompt: "Open the day. Budget {{nudge_budget_per_day}}." },
  enabled_by_default: true,
};

// --------------------------------------------------------------------------
// install
// --------------------------------------------------------------------------

test("install validates, copies into the user layer and seeds schema defaults", () => {
  resetState();
  const pkg = makePackage();

  const { profile, warnings } = installProfile(pkg.dir);

  assert.equal(profile.id, pkg.id);
  assert.equal(profile.source, "user");
  assert.ok(fs.existsSync(path.join(PROFILES_DIR, pkg.id, "profile.json")));
  assert.deepEqual(warnings, []);

  const cfg = readConfig();
  assert.equal(cfg.profile.active, null, "install must NOT activate");
  // `config` mirrors the ACTIVE profile, so it stays empty until `use`; the
  // seeded settings live in the per-profile store behind it.
  assert.deepEqual(cfg.profile.config, {});
  assert.equal(cfg.profile.configs[pkg.id].day_open_at, "08:30", "defaults are seeded");
  assert.equal(cfg.profile.configs[pkg.id].nudge_budget_per_day, 3);
});

test("install rejects a prompt more than 1.5x its declared budget, and leaves nothing behind", () => {
  resetState();
  const pkg = makePackage({
    prompt: "word ".repeat(2000), // ~2500 tokens
    manifest: { prompt_budget_tokens: 900 },
  });

  assert.throws(() => installProfile(pkg.dir), /1\.5x its declared budget/);
  assert.ok(
    !fs.existsSync(path.join(PROFILES_DIR, pkg.id)),
    "a failed install must roll back its copy"
  );
});

test("install warns — but succeeds — when the prompt merely exceeds its budget", () => {
  resetState();
  const pkg = makePackage({
    prompt: "word ".repeat(300), // ~375 tokens
    manifest: { prompt_budget_tokens: 300 },
  });

  const { warnings } = installProfile(pkg.dir);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /against a declared budget of 300/);
});

test("install rejects a malformed manifest with a message naming the field", () => {
  resetState();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-pkg-bad-"));
  fs.writeFileSync(path.join(dir, "profile.json"), JSON.stringify({ id: "bad" })); // no name/version
  fs.writeFileSync(path.join(dir, "PROFILE.md"), "# Role\nbody");

  assert.throws(() => installProfile(dir), /"name" is required/);
});

test("install rejects a schema whose default is outside its own enum", () => {
  resetState();
  const pkg = makePackage({
    schema: {
      type: "object",
      properties: { formality: { type: "string", enum: ["tu", "vos"], default: "usted" } },
    },
  });
  assert.throws(() => installProfile(pkg.dir), /default "usted" is not in its enum/);
});

test("resolveInstallSource refuses remote sources rather than pretending", () => {
  assert.throws(() => resolveInstallSource("https://example.com/p.zip"), /not supported yet/);
  assert.throws(() => resolveInstallSource("Not A Slug"), /invalid id|no profile\.json/);
});

// --------------------------------------------------------------------------
// use / off round-trip  (spec § 9, test 4)
// --------------------------------------------------------------------------

test("install → use → off → use preserves settings and re-enables the routines", () => {
  resetState();
  const pkg = makePackage({ routines: { "day-open": DAY_OPEN_ROUTINE } });

  installProfile(pkg.dir);
  setProfileConfig({ day_open_at: "30 9 * * 1-5" }, { id: pkg.id });

  const used = useProfile(pkg.id);
  assert.deepEqual(used.routines.installed, [`${pkg.id}-day-open`]);
  assert.equal(readConfig().profile.active, pkg.id);

  const installedRoutine = listRoutines(SA_STORAGE).find((r) => r.name === `${pkg.id}-day-open`);
  assert.ok(installedRoutine.enabled);
  assert.equal(installedRoutine.origin, `profile:${pkg.id}`);
  assert.equal(installedRoutine.schedule, "cron:30 9 * * 1-5", "config is rendered into the cron");

  // off
  const offResult = offProfile();
  assert.equal(offResult.was, pkg.id);
  assert.equal(readConfig().profile.active, null);
  assert.equal(
    listRoutines(SA_STORAGE).find((r) => r.name === `${pkg.id}-day-open`).enabled,
    false,
    "off disables the routine"
  );
  assert.ok(
    listRoutines(SA_STORAGE).some((r) => r.name === `${pkg.id}-day-open`),
    "off must NOT delete the routine"
  );

  // back on
  useProfile(pkg.id);
  const cfg = readConfig();
  assert.equal(cfg.profile.active, pkg.id);
  assert.equal(cfg.profile.config.day_open_at, "30 9 * * 1-5", "settings survived the round-trip");
  assert.equal(
    listRoutines(SA_STORAGE).find((r) => r.name === `${pkg.id}-day-open`).enabled,
    true,
    "the routine comes back enabled"
  );
});

test("only one profile is active at a time, and replacing one requires confirmation", () => {
  resetState();
  const a = makePackage();
  const b = makePackage();
  installProfile(a.dir);
  installProfile(b.dir);

  useProfile(a.id);
  assert.throws(() => useProfile(b.id), /already active/);

  useProfile(b.id, { confirmReplace: true });
  assert.equal(readConfig().profile.active, b.id);
});

test("switching profiles does not bleed one's settings into the other", () => {
  resetState();
  const a = makePackage();
  const b = makePackage();
  installProfile(a.dir);
  installProfile(b.dir);

  useProfile(a.id);
  setProfileConfig({ day_open_at: "AAA" });
  assert.equal(readConfig().profile.config.day_open_at, "AAA");

  useProfile(b.id, { confirmReplace: true });
  assert.equal(
    readConfig().profile.config.day_open_at,
    "08:30",
    "B must start from its own defaults, not A's settings"
  );

  useProfile(a.id, { confirmReplace: true });
  assert.equal(readConfig().profile.config.day_open_at, "AAA", "A gets its own settings back");
});

// --------------------------------------------------------------------------
// config  (spec § 9, test 7)
// --------------------------------------------------------------------------

test("an unknown setting is rejected with a message listing what is accepted", () => {
  resetState();
  const pkg = makePackage();
  installProfile(pkg.dir);
  useProfile(pkg.id);

  assert.throws(
    () => setProfileConfig({ not_a_setting: "x" }),
    /unknown setting "not_a_setting".*accepts: day_open_at/s
  );
});

test("a value outside an enum is rejected with the allowed values", () => {
  resetState();
  const pkg = makePackage();
  installProfile(pkg.dir);
  useProfile(pkg.id);

  assert.throws(() => setProfileConfig({ formality: "shouting" }), /must be one of: tu, vos, neutral/);
});

test("CLI-style string values are coerced to their declared type", () => {
  resetState();
  const pkg = makePackage();
  installProfile(pkg.dir);
  useProfile(pkg.id);

  const { config } = setProfileConfig({ nudge_budget_per_day: "7" });
  assert.strictEqual(config.nudge_budget_per_day, 7, "coerced to integer, not left a string");

  assert.throws(() => setProfileConfig({ nudge_budget_per_day: "many" }), /must be a integer/);
});

test("changing a setting really moves the cron, not just the JSON", () => {
  resetState();
  const pkg = makePackage({ routines: { "day-open": DAY_OPEN_ROUTINE } });
  installProfile(pkg.dir);
  useProfile(pkg.id);

  const before = listRoutines(SA_STORAGE).find((r) => r.name === `${pkg.id}-day-open`);
  assert.equal(before.schedule, "cron:08:30");

  setProfileConfig({ day_open_at: "0 7 * * *" });

  const after = listRoutines(SA_STORAGE).find((r) => r.name === `${pkg.id}-day-open`);
  assert.equal(after.schedule, "cron:0 7 * * *");
  assert.equal(after.id, before.id, "the routine keeps its identity across a config change");
});

// --------------------------------------------------------------------------
// uninstall  (spec § 9, test 6)
// --------------------------------------------------------------------------

test("uninstall removes the package's own routines", () => {
  resetState();
  const pkg = makePackage({ routines: { "day-open": DAY_OPEN_ROUTINE } });
  installProfile(pkg.dir);
  useProfile(pkg.id);

  const result = uninstallProfile(pkg.id);

  assert.deepEqual(result.routines.removed, [`${pkg.id}-day-open`]);
  assert.equal(listRoutines(SA_STORAGE).length, 0);
  assert.ok(!fs.existsSync(path.join(PROFILES_DIR, pkg.id)));
  assert.equal(readConfig().profile.active, null);
});

test("uninstall keeps a routine the user edited, and never touches their own", () => {
  resetState();
  const pkg = makePackage({ routines: { "day-open": DAY_OPEN_ROUTINE } });
  installProfile(pkg.dir);
  useProfile(pkg.id);

  // The user makes the profile's routine their own…
  upsertRoutine(SA_STORAGE, {
    name: `${pkg.id}-day-open`,
    kind: "super_agent",
    schedule: "cron:0 6 * * *",
    spec: { prompt: "my own wording" },
  });
  // …and has a routine of their own that has nothing to do with the profile.
  upsertRoutine(SA_STORAGE, {
    name: "my-own",
    kind: "heartbeat",
    schedule: "every:1h",
    spec: {},
  });

  const result = uninstallProfile(pkg.id);

  assert.deepEqual(result.routines.removed, []);
  assert.deepEqual(result.routines.kept, [`${pkg.id}-day-open`]);

  const left = listRoutines(SA_STORAGE).map((r) => r.name).sort();
  assert.deepEqual(left, [`${pkg.id}-day-open`, "my-own"].sort());
});

test("a profile never hijacks a routine the user already owns by that name", () => {
  resetState();
  const pkg = makePackage({ routines: { "day-open": DAY_OPEN_ROUTINE } });
  installProfile(pkg.dir);

  upsertRoutine(SA_STORAGE, {
    name: `${pkg.id}-day-open`,
    kind: "heartbeat",
    schedule: "every:2h",
    spec: { message: "mine" },
  });

  const { routines } = useProfile(pkg.id);
  assert.deepEqual(routines.installed, []);
  assert.deepEqual(routines.skipped, [{ name: `${pkg.id}-day-open`, reason: "user_owned" }]);
  assert.equal(
    listRoutines(SA_STORAGE).find((r) => r.name === `${pkg.id}-day-open`).kind,
    "heartbeat",
    "the user's routine is untouched"
  );
});

// --------------------------------------------------------------------------
// doctor
// --------------------------------------------------------------------------

test("doctor reports vanilla cleanly when nothing is active", () => {
  resetState();
  const report = profileDoctor();
  assert.equal(report.active, false);
  assert.equal(report.ok, true);
  assert.match(report.summary, /vanilla/i);
});

test("doctor flags a missing channel with the command that fixes it", () => {
  resetState();
  const pkg = makePackage({ manifest: { requires: { channels: ["telegram"] } } });
  installProfile(pkg.dir);
  useProfile(pkg.id);

  const report = profileDoctor();
  const channel = report.checks.find((c) => c.label === "channel");
  assert.ok(channel, "expected a channel check");
  assert.equal(channel.fix, "apx telegram setup");
});

test("doctor reports an undeclared capability as a degradation, not a crash", () => {
  resetState();
  const pkg = makePackage({ manifest: { requires: { capabilities: ["nudge.budget"] } } });
  installProfile(pkg.dir);
  useProfile(pkg.id);

  const report = profileDoctor();
  const cap = report.checks.find((c) => c.label === "capability");
  assert.ok(cap);
  assert.equal(cap.level, "warn");
  assert.match(cap.detail, /nudge\.budget/);
  assert.equal(report.ok, true, "a missing optional capability must not block");
});

// --------------------------------------------------------------------------
// listing
// --------------------------------------------------------------------------

test("listProfilesWithState marks the active one", () => {
  resetState();
  const pkg = makePackage();
  installProfile(pkg.dir);
  useProfile(pkg.id);

  const row = listProfilesWithState().find((p) => p.id === pkg.id);
  assert.ok(row);
  assert.equal(row.active, true);
  assert.equal(row.source, "user");
  assert.equal(row.version, "1.0.0");
});

test("estimateTokens is the same 4-chars-per-token rule used elsewhere", () => {
  assert.equal(estimateTokens("a".repeat(400)), 100);
  assert.equal(estimateTokens(""), 0);
});

// --------------------------------------------------------------------------
// The install gate on template variables
// --------------------------------------------------------------------------

test("install FAILS on a template variable with no default and no fallback", () => {
  resetState();
  const pkg = makePackage({ prompt: "# Role\nGreet {{owner_name}} about {{undeclared_thing}}." });

  assert.throws(() => installProfile(pkg.dir), /\{\{undeclared_thing\}\}/);
  assert.ok(
    !fs.existsSync(path.join(PROFILES_DIR, pkg.id)),
    "a rejected package must not be left behind"
  );
});

test("install FAILS on a dotted variable the renderer cannot substitute", () => {
  resetState();
  const pkg = makePackage({ prompt: "# Role: {{profile.name}}\nBody." });
  assert.throws(() => installProfile(pkg.dir), /only flat \{\{single_word\}\} names/);
});

test("install FAILS on a schema property declared without a default", () => {
  resetState();
  const pkg = makePackage({
    prompt: "# Role\nTone is {{tone}}.",
    schema: { type: "object", properties: { tone: { type: "string" } } }, // no default
  });
  assert.throws(() => installProfile(pkg.dir), /no default — it would render as an empty string/);
});

test("built-in variables always resolve, even with an empty schema", () => {
  resetState();
  const pkg = makePackage({
    prompt: "# Role\n{{owner_name}} / {{agent_name}} / {{profile_name}} / {{owner_context}}",
    schema: null,
  });
  const { profile } = installProfile(pkg.dir);
  assert.equal(profile.id, pkg.id);
});

test("the gate also covers channel overlays, not just PROFILE.md", () => {
  resetState();
  const pkg = makePackage();
  fs.mkdirSync(path.join(pkg.dir, "channels"));
  fs.writeFileSync(path.join(pkg.dir, "channels", "routine.md"), "Budget {{not_a_setting}}.");

  assert.throws(() => installProfile(pkg.dir), /routine\.md — .*\{\{not_a_setting\}\}/s);
});

test("off and uninstall clear the active-profile mirror but keep the settings", () => {
  resetState();
  const pkg = makePackage();
  installProfile(pkg.dir);
  useProfile(pkg.id);
  setProfileConfig({ day_open_at: "07:15" });

  offProfile();
  let cfg = readConfig();
  assert.equal(cfg.profile.active, null);
  assert.deepEqual(
    cfg.profile.config,
    {},
    "the mirror describes the ACTIVE profile — it must not keep a deactivated one's settings"
  );
  assert.equal(
    cfg.profile.configs[pkg.id].day_open_at,
    "07:15",
    "the settings themselves survive, so `use` restores them"
  );

  useProfile(pkg.id);
  assert.equal(readConfig().profile.config.day_open_at, "07:15");

  uninstallProfile(pkg.id);
  cfg = readConfig();
  assert.equal(cfg.profile.active, null);
  assert.deepEqual(cfg.profile.config, {});
});

// A Spanish speaker pays for PROFILE.es.md, so checking only the base file
// would let a translation ship over budget for exactly the people who read it.
test("the prompt budget is enforced on every translation, not just English", () => {
  resetState();
  const pkg = makePackage({
    prompt: "word ".repeat(200),          // ~250 tokens, inside the budget
    manifest: { prompt_budget_tokens: 300 },
  });
  // ~350 tokens: over the 300 budget but under the 1.5x hard-fail line.
  fs.writeFileSync(path.join(pkg.dir, "PROFILE.es.md"), "palabra ".repeat(175));

  const { warnings } = installProfile(pkg.dir);
  assert.equal(warnings.length, 1, "the oversized translation must be reported");
  assert.match(warnings[0], /PROFILE\.es\.md is ~\d+ tokens/);
});

test("a translation more than 1.5x over budget fails the install", () => {
  resetState();
  const pkg = makePackage({
    prompt: "word ".repeat(100),
    manifest: { prompt_budget_tokens: 300 },
  });
  fs.writeFileSync(path.join(pkg.dir, "PROFILE.es.md"), "palabra ".repeat(600)); // ~1200

  assert.throws(() => installProfile(pkg.dir), /PROFILE\.es\.md is ~\d+ tokens, more than 1\.5x/);
});

// --------------------------------------------------------------------------
// The bundled secretary package
// --------------------------------------------------------------------------

test("the bundled secretary package is valid and within its declared budget", async () => {
  const { readProfile, measureProfilePrompts, validateProfilePackage } =
    await import("#core/profiles/index.js");

  const secretary = readProfile("secretary");
  assert.ok(secretary, "secretary should resolve from the bundled layer");
  assert.equal(secretary.source, "bundled");

  const report = validateProfilePackage(secretary);
  assert.equal(report.ok, true, report.errors.join("; "));

  const budget = secretary.manifest.prompt_budget_tokens;
  const measured = measureProfilePrompts(secretary, readConfig());
  for (const { lang, tokens } of measured) {
    assert.ok(tokens <= budget, `PROFILE (${lang}) is ${tokens} tokens, over the ${budget} budget`);
  }

  // System prompts ship in English only. A translated PROFILE.<lang>.md would be
  // a second prompt to keep in sync and drift silently; the agent is told to
  // reply in the owner's language instead.
  assert.deepEqual(measured.map((m) => m.lang), ["en"]);
  assert.deepEqual(secretary.manifest.languages, ["en"]);
});

test("the secretary's routines carry schedules the scheduler can actually parse", async () => {
  const { readProfile, renderProfileRoutines } = await import("#core/profiles/index.js");
  const { parseSchedule } = await import("#core/stores/routines.js");

  const secretary = readProfile("secretary");
  const routines = renderProfileRoutines(secretary, {
    profile: { active: "secretary", config: secretary.defaults },
  });

  assert.ok(routines.length >= 2, "expected the day-open and day-close anchors");
  for (const r of routines) {
    // A schedule that stores fine but does not parse is a routine that silently
    // never runs — getDueRoutines drops anything parseSchedule calls invalid.
    assert.notEqual(
      parseSchedule(r.schedule).kind,
      "invalid",
      `${r.name} has an unparseable schedule: ${JSON.stringify(r.schedule)}`
    );
  }
});
