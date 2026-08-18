// The calendar seam (02-SPEC-capabilities.md § C6, phase 8).
//
// The design claim being defended here: an anchor reads the agenda WITHOUT the
// unattended routine holding a permission to call MCP servers. It gets the text
// from its own pre_command, which the user configures once. So the tests are
// about three joins — a blank setting leaving no command behind, {{pre_output}}
// surviving the profile renderer and being filled by the routine runner, and
// the anchor still not being allowed to call anything dangerous by itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-calendar-"));
process.env.HOME = TMP_HOME;

const { readProfile, renderProfileRoutines } = await import("#core/profiles/index.js");
const { profileDoctor } = await import("#core/profiles/lifecycle.js");
const { readConfig, writeConfig } = await import("#core/config/index.js");
const { runRoutineNow } = await import("#core/routines/runner.js");

/** The bundled secretary's routines, rendered against the given settings. */
function secretaryRoutines(overrides = {}) {
  const secretary = readProfile("secretary");
  return renderProfileRoutines(secretary, {
    profile: { active: "secretary", config: { ...secretary.defaults, ...overrides } },
  });
}

const dayOpen = (routines) => routines.find((r) => r.name === "secretary-day-open");

// --------------------------------------------------------------------------
// rendering
// --------------------------------------------------------------------------

test("no calendar configured leaves no command behind at all", () => {
  const anchor = dayOpen(secretaryRoutines());

  // Not `pre_commands: [""]`. An empty string would still make the runner
  // treat the routine as having a pre phase — spawning a shell to run nothing,
  // and flipping the skip_prompt_on / {{pre_output}} behaviour with it.
  assert.equal(anchor.pre_commands, undefined);
});

test("a configured calendar command reaches the anchor as its pre_command", () => {
  const cmd = "apx mcp run calendar list_events '{\"timeMin\":\"today\"}'";
  const anchor = dayOpen(secretaryRoutines({ calendar_command: cmd }));

  assert.deepEqual(anchor.pre_commands, [cmd]);
});

test("{{pre_output}} survives the profile renderer", () => {
  // It belongs to the routine runtime, which fills it at run time — long after
  // rendering. An unknown variable renders as "", so without the identity
  // mapping the slot would be gone before the routine was ever installed.
  const anchor = dayOpen(secretaryRoutines({ calendar_command: "true" }));

  assert.match(anchor.spec.prompt, /\{\{pre_output\}\}/);
});

test("the morning anchor still may not call anything on its own authority", () => {
  // The whole point of routing the agenda through a pre_command: `call_mcp` is
  // dangerous and unscoped — allowing it here would hand an unattended run
  // every MCP server registered on the machine, write tools included.
  const anchor = dayOpen(secretaryRoutines({ calendar_command: "true" }));

  assert.deepEqual(anchor.allowed_tools, ["send_telegram"]);
  assert.equal(anchor.permission_mode, "permiso");
});

// --------------------------------------------------------------------------
// the runner side of the same seam
// --------------------------------------------------------------------------

function telegramCtx() {
  const storagePath = fs.mkdtempSync(path.join(TMP_HOME, "proj-"));
  const sent = [];
  return {
    sent,
    ctx: {
      project: { id: 1, name: "alpha", path: storagePath, storagePath, logMessage: () => {} },
      projects: { list: () => [], get: () => null },
      plugins: { get: () => ({ send: async ({ text }) => sent.push(text) }) },
      registries: null,
      globalConfig: {},
    },
  };
}

test("a routine with no pre output gets an empty slot, never the literal braces", async () => {
  const { ctx, sent } = telegramCtx();

  await runRoutineNow(ctx, {
    name: "no-calendar",
    kind: "telegram",
    schedule: "every:24h",
    spec: { text: "agenda:[{{pre_output}}]" },
  });

  // A placeholder that survives is not a cosmetic slip: it reaches the model as
  // text, and a model handed "{{pre_output}}" will try to make sense of it.
  assert.deepEqual(sent, ["agenda:[]"]);
});

test("pre_commands stdout lands in the slot", async () => {
  const { ctx, sent } = telegramCtx();

  await runRoutineNow(ctx, {
    name: "with-calendar",
    kind: "telegram",
    schedule: "every:24h",
    pre_commands: ["printf '09:00 dentist'"],
    spec: { text: "agenda:[{{pre_output}}]" },
  });

  assert.deepEqual(sent, ["agenda:[09:00 dentist]"]);
});

test("a calendar command that fails degrades to text, it does not fail the run", async () => {
  const { ctx, sent } = telegramCtx();

  const out = await runRoutineNow(ctx, {
    name: "broken-calendar",
    kind: "telegram",
    schedule: "every:24h",
    pre_commands: ["echo 'boom' >&2; exit 1"],
    spec: { text: "agenda:[{{pre_output}}]" },
  });

  // The agenda is optional by design: an MCP server that is down must cost the
  // owner their calendar line, not their whole morning message.
  assert.equal(out.status, "ok");
  assert.equal(sent.length, 1);
  assert.match(sent[0], /boom/);
});

// --------------------------------------------------------------------------
// doctor
// --------------------------------------------------------------------------

test("doctor sends you to MCP for an integration APX has no plugin for", () => {
  const cfg = readConfig();
  cfg.profile = { active: "secretary", config: {}, configs: { secretary: {} } };
  writeConfig(cfg);

  const report = profileDoctor("secretary");
  const calendar = report.checks.find((c) => c.label === "integration" && c.detail.startsWith("calendar"));

  assert.ok(calendar, "the optional calendar integration should be reported");
  assert.equal(calendar.level, "warn", "optional means degrade, not block");
  // `apx integration connect calendar` cannot work: there is no calendar plugin
  // in the catalog and the command answers "unknown plugin". Naming a command
  // that fails is worse than naming none.
  assert.doesNotMatch(calendar.fix || "", /integration connect/);
  assert.match(calendar.fix || "", /apx mcp add calendar/);
});

// --------------------------------------------------------------------------
// the variables a routine is rendered with
// --------------------------------------------------------------------------

test("a routine gets the identity built-ins, not just the settings", async () => {
  // The Secretary's anchor addresses the owner by name twice. Rendered with the
  // settings alone those slots came out empty, and the model was told "none of
  // that is what  asked for" — a sentence with a hole in it, shipped daily.
  const { writeIdentity } = await import("#core/identity/index.js");
  writeIdentity({ owner_name: "Manu", agent_name: "Roby" });

  const anchor = dayOpen(secretaryRoutines());

  assert.match(anchor.spec.prompt, /what Manu asked for/);
  assert.doesNotMatch(anchor.spec.prompt, /\{\{owner_name\}\}/);
});
