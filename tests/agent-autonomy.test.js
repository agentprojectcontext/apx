// An agent's own autonomy actually governs its turn.
//
// `Autonomy:` was writable from the panel, from `create_agent` and from
// `configure_agent`, was served by the API and rendered as a segmented control
// — and read by NOTHING. Every agent ran on the project's permission_mode no
// matter what its card said. A setting that changes nothing is worse than a
// missing one: it reads as a promise the system does not keep, and the whole
// point of the council being read-only rests on exactly this kind of guarantee.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "apx-autonomy-"));
process.env.APX_HOME = path.join(TMP, ".apx");

const { normalizeAutonomy, PERMISSION_MODES, DEFAULT_PERMISSION_MODE } =
  await import("#core/constants/permissions.js");
const { createPermissionGuard } = await import("#core/agent/tools/helpers.js");
const { applyAgentAutonomy } = await import("#core/agent/run-turn.js");

// --- the validator ---------------------------------------------------------

test("an unrecognised autonomy is dropped, never persisted", () => {
  // Failing open is dangerous in exactly one direction: a typo must not WIDEN
  // what an agent may do without asking.
  for (const bad of ["TOTAL", "full", "yes", "administrador", "totaly"]) {
    assert.equal(normalizeAutonomy(bad), undefined, bad);
  }
  for (const good of Object.values(PERMISSION_MODES)) {
    assert.equal(normalizeAutonomy(good), good);
  }
});

test("empty means inherit, undefined means leave it alone", () => {
  assert.equal(normalizeAutonomy(""), null, "an explicit clear");
  assert.equal(normalizeAutonomy(null), null);
  assert.equal(normalizeAutonomy(undefined), undefined, "the caller said nothing");
});

// --- the guard reads it ----------------------------------------------------

async function blocks(mode, tool, { dangerous = false, allowed = [] } = {}) {
  const guard = createPermissionGuard(
    { super_agent: { permission_mode: mode, allowed_tools: allowed } },
    { requestConfirmation: null },
  );
  try {
    await guard(tool, { dangerous, args: {} });
    return false;
  } catch {
    return true;
  }
}

test("each mode gates what it says it gates", async () => {
  assert.equal(await blocks(PERMISSION_MODES.TOTAL, "run_shell", { dangerous: true }), false,
    "total runs everything");
  assert.equal(await blocks(PERMISSION_MODES.AUTOMATICO, "read_file"), false,
    "automatico lets a safe call through");
  assert.equal(await blocks(PERMISSION_MODES.AUTOMATICO, "run_shell", { dangerous: true }), true,
    "automatico stops a dangerous one");
  assert.equal(await blocks(PERMISSION_MODES.PERMISO, "read_file"), true,
    "permiso stops even a safe call that is not on the list");
  assert.equal(await blocks(PERMISSION_MODES.PERMISO, "read_file", { allowed: ["read_file"] }), false,
    "…unless it is on the list");
});

test("permiso is the strictest and total the loosest — the order the UI shows", async () => {
  const strictness = [];
  for (const mode of [PERMISSION_MODES.TOTAL, PERMISSION_MODES.AUTOMATICO, PERMISSION_MODES.PERMISO]) {
    let blocked = 0;
    for (const [tool, dangerous] of [["read_file", false], ["run_shell", true]]) {
      if (await blocks(mode, tool, { dangerous })) blocked += 1;
    }
    strictness.push(blocked);
  }
  assert.deepEqual(strictness, [0, 1, 2], "total < automatico < permiso, and nothing ties");
});

// --- the turn honours the card ---------------------------------------------

const card = (autonomy) => ({ slug: "nati", fields: autonomy ? { Name: "nati", Autonomy: autonomy } : { Name: "nati" } });
const projectCfg = () => ({ super_agent: { permission_mode: "total", allowed_tools: ["read_file"] } });

test("the project's mode governs an agent that declares nothing", () => {
  const cfg = applyAgentAutonomy(projectCfg(), card(null));
  assert.equal(cfg.super_agent.permission_mode, "total");
});

test("an agent that declares its own autonomy narrows itself, and the turn obeys", () => {
  // The regression this file exists for: the project says `total`, the card
  // says `permiso`, and before the fix the turn ran on `total` regardless.
  assert.equal(applyAgentAutonomy(projectCfg(), card("permiso")).super_agent.permission_mode, "permiso");
  assert.equal(applyAgentAutonomy(projectCfg(), card("automatico")).super_agent.permission_mode, "automatico");
});

test("a card with a junk autonomy inherits rather than widening", () => {
  assert.equal(applyAgentAutonomy(projectCfg(), card("supervisor")).super_agent.permission_mode, "total");
  assert.equal(applyAgentAutonomy(projectCfg(), card("TOTAL")).super_agent.permission_mode, "total");
});

test("narrowing the mode leaves the rest of the config alone", () => {
  // permiso reads allowed_tools, so losing it while switching mode would turn
  // "ask about anything unusual" into "ask about everything".
  const cfg = applyAgentAutonomy(projectCfg(), card("permiso"));
  assert.deepEqual(cfg.super_agent.allowed_tools, ["read_file"]);
});

test("a project with no super_agent block still gets a mode, not a crash", () => {
  const cfg = applyAgentAutonomy({}, card("permiso"));
  assert.equal(cfg.super_agent.permission_mode, "permiso");
  assert.equal(applyAgentAutonomy({}, card(null)).super_agent, undefined, "and nothing is invented");
});

test("an agent with no card at all is handled", () => {
  assert.doesNotThrow(() => applyAgentAutonomy(projectCfg(), null));
  assert.doesNotThrow(() => applyAgentAutonomy(projectCfg(), {}));
});

test("the default mode is the cautious one", () => {
  assert.equal(DEFAULT_PERMISSION_MODE, PERMISSION_MODES.AUTOMATICO);
});
