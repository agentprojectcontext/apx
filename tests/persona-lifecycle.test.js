// Persona lifecycle: install / use / off / config / doctor / uninstall.
// Covers tests 4-7 of docs-internal/secretary/01-SPEC-personas.md § 9.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-persona-life-"));
process.env.HOME = TMP_HOME;

const {
  installPersona,
  usePersona,
  offPersona,
  setPersonaConfig,
  uninstallPersona,
  personaDoctor,
  listPersonasWithState,
  resolveInstallSource,
  estimateTokens,
} = await import("#core/personas/lifecycle.js");
const { readConfig, writeConfig } = await import("#core/config/index.js");
const { listRoutines, upsertRoutine } = await import("#core/stores/routines.js");
const { projectStorageRoot, DEFAULT_PROJECT_ID } = await import("#core/config/paths.js");
const { PERSONAS_DIR } = await import("#core/personas/paths.js");

const SA_STORAGE = projectStorageRoot(DEFAULT_PROJECT_ID);

// --------------------------------------------------------------------------
// helpers
// --------------------------------------------------------------------------

let seq = 0;

/** Build a persona package in a scratch dir, ready to install by path. */
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
    path.join(dir, "persona.json"),
    JSON.stringify({ id, name: id, version: "1.0.0", ...manifest }, null, 2)
  );
  fs.writeFileSync(path.join(dir, "PERSONA.md"), prompt);
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
  delete cfg.persona;
  writeConfig(cfg);
  fs.rmSync(PERSONAS_DIR, { recursive: true, force: true });
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

  const { persona, warnings } = installPersona(pkg.dir);

  assert.equal(persona.id, pkg.id);
  assert.equal(persona.source, "user");
  assert.ok(fs.existsSync(path.join(PERSONAS_DIR, pkg.id, "persona.json")));
  assert.deepEqual(warnings, []);

  const cfg = readConfig();
  assert.equal(cfg.persona.active, null, "install must NOT activate");
  // `config` mirrors the ACTIVE persona, so it stays empty until `use`; the
  // seeded settings live in the per-persona store behind it.
  assert.deepEqual(cfg.persona.config, {});
  assert.equal(cfg.persona.configs[pkg.id].day_open_at, "08:30", "defaults are seeded");
  assert.equal(cfg.persona.configs[pkg.id].nudge_budget_per_day, 3);
});

test("install rejects a prompt more than 1.5x its declared budget, and leaves nothing behind", () => {
  resetState();
  const pkg = makePackage({
    prompt: "word ".repeat(2000), // ~2500 tokens
    manifest: { prompt_budget_tokens: 900 },
  });

  assert.throws(() => installPersona(pkg.dir), /1\.5x its declared budget/);
  assert.ok(
    !fs.existsSync(path.join(PERSONAS_DIR, pkg.id)),
    "a failed install must roll back its copy"
  );
});

test("install warns — but succeeds — when the prompt merely exceeds its budget", () => {
  resetState();
  const pkg = makePackage({
    prompt: "word ".repeat(300), // ~375 tokens
    manifest: { prompt_budget_tokens: 300 },
  });

  const { warnings } = installPersona(pkg.dir);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /against a declared budget of 300/);
});

test("install rejects a malformed manifest with a message naming the field", () => {
  resetState();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-pkg-bad-"));
  fs.writeFileSync(path.join(dir, "persona.json"), JSON.stringify({ id: "bad" })); // no name/version
  fs.writeFileSync(path.join(dir, "PERSONA.md"), "# Role\nbody");

  assert.throws(() => installPersona(dir), /"name" is required/);
});

test("install rejects a schema whose default is outside its own enum", () => {
  resetState();
  const pkg = makePackage({
    schema: {
      type: "object",
      properties: { formality: { type: "string", enum: ["tu", "vos"], default: "usted" } },
    },
  });
  assert.throws(() => installPersona(pkg.dir), /default "usted" is not in its enum/);
});

test("resolveInstallSource refuses remote sources rather than pretending", () => {
  assert.throws(() => resolveInstallSource("https://example.com/p.zip"), /not supported yet/);
  assert.throws(() => resolveInstallSource("Not A Slug"), /invalid id|no persona\.json/);
});

// --------------------------------------------------------------------------
// use / off round-trip  (spec § 9, test 4)
// --------------------------------------------------------------------------

test("install → use → off → use preserves settings and re-enables the routines", () => {
  resetState();
  const pkg = makePackage({ routines: { "day-open": DAY_OPEN_ROUTINE } });

  installPersona(pkg.dir);
  setPersonaConfig({ day_open_at: "30 9 * * 1-5" }, { id: pkg.id });

  const used = usePersona(pkg.id);
  assert.deepEqual(used.routines.installed, [`${pkg.id}-day-open`]);
  assert.equal(readConfig().persona.active, pkg.id);

  const installedRoutine = listRoutines(SA_STORAGE).find((r) => r.name === `${pkg.id}-day-open`);
  assert.ok(installedRoutine.enabled);
  assert.equal(installedRoutine.origin, `persona:${pkg.id}`);
  assert.equal(installedRoutine.schedule, "cron:30 9 * * 1-5", "config is rendered into the cron");

  // off
  const offResult = offPersona();
  assert.equal(offResult.was, pkg.id);
  assert.equal(readConfig().persona.active, null);
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
  usePersona(pkg.id);
  const cfg = readConfig();
  assert.equal(cfg.persona.active, pkg.id);
  assert.equal(cfg.persona.config.day_open_at, "30 9 * * 1-5", "settings survived the round-trip");
  assert.equal(
    listRoutines(SA_STORAGE).find((r) => r.name === `${pkg.id}-day-open`).enabled,
    true,
    "the routine comes back enabled"
  );
});

test("only one persona is active at a time, and replacing one requires confirmation", () => {
  resetState();
  const a = makePackage();
  const b = makePackage();
  installPersona(a.dir);
  installPersona(b.dir);

  usePersona(a.id);
  assert.throws(() => usePersona(b.id), /already active/);

  usePersona(b.id, { confirmReplace: true });
  assert.equal(readConfig().persona.active, b.id);
});

test("switching personas does not bleed one's settings into the other", () => {
  resetState();
  const a = makePackage();
  const b = makePackage();
  installPersona(a.dir);
  installPersona(b.dir);

  usePersona(a.id);
  setPersonaConfig({ day_open_at: "AAA" });
  assert.equal(readConfig().persona.config.day_open_at, "AAA");

  usePersona(b.id, { confirmReplace: true });
  assert.equal(
    readConfig().persona.config.day_open_at,
    "08:30",
    "B must start from its own defaults, not A's settings"
  );

  usePersona(a.id, { confirmReplace: true });
  assert.equal(readConfig().persona.config.day_open_at, "AAA", "A gets its own settings back");
});

// --------------------------------------------------------------------------
// config  (spec § 9, test 7)
// --------------------------------------------------------------------------

test("an unknown setting is rejected with a message listing what is accepted", () => {
  resetState();
  const pkg = makePackage();
  installPersona(pkg.dir);
  usePersona(pkg.id);

  assert.throws(
    () => setPersonaConfig({ not_a_setting: "x" }),
    /unknown setting "not_a_setting".*accepts: day_open_at/s
  );
});

test("a value outside an enum is rejected with the allowed values", () => {
  resetState();
  const pkg = makePackage();
  installPersona(pkg.dir);
  usePersona(pkg.id);

  assert.throws(() => setPersonaConfig({ formality: "shouting" }), /must be one of: tu, vos, neutral/);
});

test("CLI-style string values are coerced to their declared type", () => {
  resetState();
  const pkg = makePackage();
  installPersona(pkg.dir);
  usePersona(pkg.id);

  const { config } = setPersonaConfig({ nudge_budget_per_day: "7" });
  assert.strictEqual(config.nudge_budget_per_day, 7, "coerced to integer, not left a string");

  assert.throws(() => setPersonaConfig({ nudge_budget_per_day: "many" }), /must be a integer/);
});

test("changing a setting really moves the cron, not just the JSON", () => {
  resetState();
  const pkg = makePackage({ routines: { "day-open": DAY_OPEN_ROUTINE } });
  installPersona(pkg.dir);
  usePersona(pkg.id);

  const before = listRoutines(SA_STORAGE).find((r) => r.name === `${pkg.id}-day-open`);
  assert.equal(before.schedule, "cron:08:30");

  setPersonaConfig({ day_open_at: "0 7 * * *" });

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
  installPersona(pkg.dir);
  usePersona(pkg.id);

  const result = uninstallPersona(pkg.id);

  assert.deepEqual(result.routines.removed, [`${pkg.id}-day-open`]);
  assert.equal(listRoutines(SA_STORAGE).length, 0);
  assert.ok(!fs.existsSync(path.join(PERSONAS_DIR, pkg.id)));
  assert.equal(readConfig().persona.active, null);
});

test("uninstall keeps a routine the user edited, and never touches their own", () => {
  resetState();
  const pkg = makePackage({ routines: { "day-open": DAY_OPEN_ROUTINE } });
  installPersona(pkg.dir);
  usePersona(pkg.id);

  // The user makes the persona's routine their own…
  upsertRoutine(SA_STORAGE, {
    name: `${pkg.id}-day-open`,
    kind: "super_agent",
    schedule: "cron:0 6 * * *",
    spec: { prompt: "my own wording" },
  });
  // …and has a routine of their own that has nothing to do with the persona.
  upsertRoutine(SA_STORAGE, {
    name: "my-own",
    kind: "heartbeat",
    schedule: "every:1h",
    spec: {},
  });

  const result = uninstallPersona(pkg.id);

  assert.deepEqual(result.routines.removed, []);
  assert.deepEqual(result.routines.kept, [`${pkg.id}-day-open`]);

  const left = listRoutines(SA_STORAGE).map((r) => r.name).sort();
  assert.deepEqual(left, [`${pkg.id}-day-open`, "my-own"].sort());
});

test("a persona never hijacks a routine the user already owns by that name", () => {
  resetState();
  const pkg = makePackage({ routines: { "day-open": DAY_OPEN_ROUTINE } });
  installPersona(pkg.dir);

  upsertRoutine(SA_STORAGE, {
    name: `${pkg.id}-day-open`,
    kind: "heartbeat",
    schedule: "every:2h",
    spec: { message: "mine" },
  });

  const { routines } = usePersona(pkg.id);
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
  const report = personaDoctor();
  assert.equal(report.active, false);
  assert.equal(report.ok, true);
  assert.match(report.summary, /vanilla/i);
});

test("doctor flags a missing channel with the command that fixes it", () => {
  resetState();
  const pkg = makePackage({ manifest: { requires: { channels: ["telegram"] } } });
  installPersona(pkg.dir);
  usePersona(pkg.id);

  const report = personaDoctor();
  const channel = report.checks.find((c) => c.label === "channel");
  assert.ok(channel, "expected a channel check");
  assert.equal(channel.fix, "apx telegram setup");
});

test("doctor reports an undeclared capability as a degradation, not a crash", () => {
  resetState();
  const pkg = makePackage({ manifest: { requires: { capabilities: ["nudge.budget"] } } });
  installPersona(pkg.dir);
  usePersona(pkg.id);

  const report = personaDoctor();
  const cap = report.checks.find((c) => c.label === "capability");
  assert.ok(cap);
  assert.equal(cap.level, "warn");
  assert.match(cap.detail, /nudge\.budget/);
  assert.equal(report.ok, true, "a missing optional capability must not block");
});

// --------------------------------------------------------------------------
// listing
// --------------------------------------------------------------------------

test("listPersonasWithState marks the active one", () => {
  resetState();
  const pkg = makePackage();
  installPersona(pkg.dir);
  usePersona(pkg.id);

  const row = listPersonasWithState().find((p) => p.id === pkg.id);
  assert.ok(row);
  assert.equal(row.active, true);
  assert.equal(row.source, "user");
  assert.equal(row.version, "1.0.0");
});

test("estimateTokens is the same 4-chars-per-token rule used elsewhere", () => {
  assert.equal(estimateTokens("a".repeat(400)), 100);
  assert.equal(estimateTokens(""), 0);
});
