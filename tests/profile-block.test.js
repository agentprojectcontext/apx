// The profile prompt block, and the invariant that governs the whole subsystem:
//
//   with no profile active, the super-agent prompt is byte-identical to what it
//   was before profiles existed.
//
// Everything else in the profiles subsystem is reversible. This is not: if a
// vanilla install's prompt drifts, every user who never asked for a profile
// pays for it. See docs-internal/secretary/01-SPEC-profiles.md § 9, test 1.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Point APX_HOME at a temp dir BEFORE importing anything that reads it —
// buildSuperAgentSystem calls readIdentity() internally, so without this the
// result depends on whose machine runs the suite.
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-profile-test-"));
process.env.HOME = TMP_HOME;

const { buildSuperAgentSystem } = await import("#core/agent/prompt-builder.js");
const { buildProfileBlock, renderProfilePrompt, clearProfileBlockCache } =
  await import("#core/profiles/block.js");
const { readProfile, listProfiles } = await import("#core/profiles/store.js");
const { PROFILES_DIR } = await import("#core/profiles/paths.js");

// --------------------------------------------------------------------------

const IDENTITY = { agent_name: "Nova", owner_name: "Ada", language: "en" };

const BASE_ARGS = {
  globalConfig: { user: { language: "en" } },
  projects: [],
  listSkills: () => [],
  channel: "telegram",
  channelMeta: {},
};

/** Write a profile package into the user layer of the temp home. */
function installTestProfile(id, { prompt, manifest = {}, schema = null, lang = null } = {}) {
  const dir = path.join(PROFILES_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "profile.json"),
    JSON.stringify({ id, name: id, version: "1.0.0", ...manifest }, null, 2)
  );
  const file = lang ? `PROFILE.${lang}.md` : "PROFILE.md";
  fs.writeFileSync(path.join(dir, file), prompt);
  if (schema) {
    fs.writeFileSync(path.join(dir, "config.schema.json"), JSON.stringify(schema, null, 2));
  }
  clearProfileBlockCache();
  return dir;
}

function removeTestProfile(id) {
  fs.rmSync(path.join(PROFILES_DIR, id), { recursive: true, force: true });
  clearProfileBlockCache();
}

// --------------------------------------------------------------------------
// The invariant
// --------------------------------------------------------------------------

test("VANILLA: no profile key at all produces a prompt with no profile content", () => {
  const system = buildSuperAgentSystem(BASE_ARGS);
  assert.ok(system.length > 0);
  assert.ok(!system.includes("{{"), "no unrendered template variables");
});

test("VANILLA: every 'no profile' config shape yields the identical prompt", () => {
  const baseline = buildSuperAgentSystem(BASE_ARGS);

  const shapes = [
    { user: { language: "en" } },                      // key absent
    { user: { language: "en" }, profile: null },       // key null
    { user: { language: "en" }, profile: {} },         // object, no active
    { user: { language: "en" }, profile: { active: null } },
    { user: { language: "en" }, profile: { active: "" } },
    { user: { language: "en" }, profile: { active: "does-not-exist" } },
  ];

  for (const globalConfig of shapes) {
    assert.equal(
      buildSuperAgentSystem({ ...BASE_ARGS, globalConfig }),
      baseline,
      `prompt drifted for config ${JSON.stringify(globalConfig.profile)}`
    );
  }
});

// The real regression risk: a package sitting on disk changing the prompt of
// someone who never activated it.
test("VANILLA: an installed-but-inactive profile does not touch the prompt", () => {
  const baseline = buildSuperAgentSystem(BASE_ARGS);
  try {
    installTestProfile("dormant", { prompt: "# Role: Dormant\nYou should not appear." });

    assert.equal(
      buildSuperAgentSystem(BASE_ARGS),
      baseline,
      "installing a profile changed the prompt of a vanilla install"
    );
    assert.ok(!buildSuperAgentSystem(BASE_ARGS).includes("Dormant"));
  } finally {
    removeTestProfile("dormant");
  }
});

test("buildProfileBlock returns empty string for every inactive shape", () => {
  for (const cfg of [undefined, {}, { profile: null }, { profile: { active: null } }]) {
    assert.equal(buildProfileBlock(IDENTITY, cfg), "");
  }
});

// --------------------------------------------------------------------------
// Injection
// --------------------------------------------------------------------------

test("an active profile is injected between identity and custom instructions", () => {
  try {
    installTestProfile("tester", { prompt: "# Role: Tester\nPROFILE_MARKER" });

    const globalConfig = {
      user: { language: "en" },
      super_agent: { instructions: "CUSTOM_MARKER" },
      profile: { active: "tester", config: {} },
    };
    const system = buildSuperAgentSystem({ ...BASE_ARGS, globalConfig });

    assert.ok(system.includes("PROFILE_MARKER"), "profile block missing");

    const identityAt = system.indexOf("# Agent profile");
    const profileAt = system.indexOf("PROFILE_MARKER");
    const customAt = system.indexOf("CUSTOM_MARKER");

    assert.ok(identityAt >= 0 && profileAt >= 0 && customAt >= 0);
    assert.ok(identityAt < profileAt, "profile must come after the identity block");
    assert.ok(
      profileAt < customAt,
      "custom instructions must come after the profile so the user wins on recency"
    );
  } finally {
    removeTestProfile("tester");
  }
});

test("deactivating restores the vanilla prompt exactly", () => {
  const baseline = buildSuperAgentSystem(BASE_ARGS);
  try {
    installTestProfile("tester", { prompt: "# Role: Tester\nPROFILE_MARKER" });

    const on = buildSuperAgentSystem({
      ...BASE_ARGS,
      globalConfig: { user: { language: "en" }, profile: { active: "tester" } },
    });
    assert.ok(on.includes("PROFILE_MARKER"));

    const off = buildSuperAgentSystem({
      ...BASE_ARGS,
      globalConfig: { user: { language: "en" }, profile: { active: null } },
    });
    assert.equal(off, baseline, "turning a profile off must restore vanilla byte-for-byte");
  } finally {
    removeTestProfile("tester");
  }
});

// --------------------------------------------------------------------------
// Rendering
// --------------------------------------------------------------------------

test("template variables resolve from profile config and identity", () => {
  try {
    installTestProfile("vars", {
      prompt: "Owner is {{owner_name}}. Budget {{nudge_budget_per_day}}. Agent {{agent_name}}.",
      schema: { type: "object", properties: { nudge_budget_per_day: { type: "integer", default: 3 } } },
    });

    const block = buildProfileBlock(IDENTITY, {
      profile: { active: "vars", config: { nudge_budget_per_day: 7 } },
    });

    assert.match(block, /Owner is Ada\./, "owner_name comes from identity.json");
    assert.match(block, /Budget 7\./, "saved config wins over the schema default");
    assert.match(block, /Agent Nova\./);
  } finally {
    removeTestProfile("vars");
  }
});

test("schema defaults fill in settings the user never configured", () => {
  try {
    installTestProfile("defaults", {
      prompt: "Quiet hours {{quiet_hours}}.",
      schema: { type: "object", properties: { quiet_hours: { type: "string", default: "22:00-07:30" } } },
    });

    const block = buildProfileBlock(IDENTITY, { profile: { active: "defaults", config: {} } });
    assert.match(block, /Quiet hours 22:00-07:30\./);
  } finally {
    removeTestProfile("defaults");
  }
});

// A visible {{…}} in the prompt is a severity-high bug (spec § 8). Neither a
// missing value nor a variable the renderer cannot parse may leak braces.
test("no orphan {{...}} survives, and a missing owner falls back to neutral prose", () => {
  try {
    installTestProfile("orphans", {
      prompt: "You are {{owner_name}}'s assistant. {{profile.name}} {{never_declared}} end.",
    });

    const block = buildProfileBlock({ agent_name: "Nova" }, { profile: { active: "orphans" } });

    assert.ok(!block.includes("{{"), `orphan braces survived: ${block}`);
    assert.match(block, /You are the owner's assistant\./, "neutral fallback for owner_name");
    assert.match(block, /end\.$/);
  } finally {
    removeTestProfile("orphans");
  }
});

test("language selection prefers PROFILE.<lang>.md and falls back to English", () => {
  try {
    const dir = installTestProfile("multi", { prompt: "ENGLISH BODY" });
    fs.writeFileSync(path.join(dir, "PROFILE.es.md"), "CUERPO EN ESPANOL");
    clearProfileBlockCache();

    const es = buildProfileBlock(
      { ...IDENTITY, language: "es" },
      { user: { language: "es" }, profile: { active: "multi" } }
    );
    assert.match(es, /CUERPO EN ESPANOL/);

    const fr = buildProfileBlock(
      { ...IDENTITY, language: "fr" },
      { user: { language: "fr" }, profile: { active: "multi" } }
    );
    assert.match(fr, /ENGLISH BODY/, "an unsupported language degrades to English");
  } finally {
    removeTestProfile("multi");
  }
});

test("a profile with no readable prompt file yields an empty block, not a crash", () => {
  const dir = path.join(PROFILES_DIR, "empty");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "profile.json"),
    JSON.stringify({ id: "empty", name: "Empty", version: "1.0.0" })
  );
  clearProfileBlockCache();
  try {
    assert.equal(buildProfileBlock(IDENTITY, { profile: { active: "empty" } }), "");
  } finally {
    removeTestProfile("empty");
  }
});

// --------------------------------------------------------------------------
// Store
// --------------------------------------------------------------------------

test("listProfiles surfaces bundled packages and readProfile resolves them", () => {
  const all = listProfiles();
  assert.ok(Array.isArray(all));
  for (const p of all) {
    assert.ok(p.id && p.manifest, "every listed profile resolves to a manifest");
    assert.ok(["bundled", "user", "user-override"].includes(p.source));
  }
});

test("a user package overrides a bundled one of the same id", () => {
  const bundled = listProfiles().find((p) => p.source === "bundled");
  if (!bundled) return; // no bundled profiles yet — nothing to assert
  try {
    installTestProfile(bundled.id, { prompt: "OVERRIDDEN" });
    const resolved = readProfile(bundled.id);
    assert.equal(resolved.source, "user-override");
    assert.match(
      renderProfilePrompt(resolved, { identity: IDENTITY }),
      /OVERRIDDEN/
    );
  } finally {
    removeTestProfile(bundled.id);
  }
});

// --------------------------------------------------------------------------
// Channel overlays
// --------------------------------------------------------------------------

function addChannelOverlay(id, channel, body) {
  const dir = path.join(PROFILES_DIR, id, "channels");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${channel}.md`), body);
  clearProfileBlockCache();
}

test("a channel overlay loads only on its own channel", () => {
  try {
    installTestProfile("overlay", { prompt: "# Role: Tester\nCORE_MARKER" });
    addChannelOverlay("overlay", "routine", "ROUTINE_ONLY_MARKER");

    const globalConfig = { user: { language: "en" }, profile: { active: "overlay" } };

    const onRoutine = buildSuperAgentSystem({ ...BASE_ARGS, channel: "routine", globalConfig });
    assert.ok(onRoutine.includes("CORE_MARKER"), "the always-on block is still there");
    assert.ok(onRoutine.includes("ROUTINE_ONLY_MARKER"), "the overlay loads on its channel");

    for (const channel of ["telegram", "cli", "web", "desktop"]) {
      const system = buildSuperAgentSystem({ ...BASE_ARGS, channel, globalConfig });
      assert.ok(system.includes("CORE_MARKER"), `${channel}: core block missing`);
      assert.ok(
        !system.includes("ROUTINE_ONLY_MARKER"),
        `${channel} must not pay for the routine overlay`
      );
    }
  } finally {
    removeTestProfile("overlay");
  }
});

test("the overlay follows the core channel file, which keeps owning formatting", () => {
  try {
    installTestProfile("overlay", { prompt: "# Role: Tester\nCORE_MARKER" });
    addChannelOverlay("overlay", "routine", "OVERLAY_MARKER");

    const system = buildSuperAgentSystem({
      ...BASE_ARGS,
      channel: "routine",
      globalConfig: { user: { language: "en" }, profile: { active: "overlay" } },
    });

    // channels/routine.md opens with the shared "# Channel context" heading.
    const coreAt = system.indexOf("# Channel context");
    const overlayAt = system.indexOf("OVERLAY_MARKER");
    assert.ok(coreAt >= 0, "core channel block missing");
    assert.ok(coreAt < overlayAt, "the overlay must be appended after the core channel file");
  } finally {
    removeTestProfile("overlay");
  }
});

test("an overlay renders profile settings and channel metadata", () => {
  try {
    installTestProfile("overlay", {
      prompt: "# Role: Tester\nbody",
      schema: { type: "object", properties: { nudge_budget_per_day: { type: "integer", default: 3 } } },
    });
    addChannelOverlay("overlay", "routine", "Budget {{nudge_budget_per_day}} for {{routineName}}.");

    const system = buildSuperAgentSystem({
      ...BASE_ARGS,
      channel: "routine",
      channelMeta: { routineName: "day-open" },
      globalConfig: {
        user: { language: "en" },
        profile: { active: "overlay", config: { nudge_budget_per_day: 5 } },
      },
    });

    assert.ok(system.includes("Budget 5 for day-open."), "settings and channelMeta both render");
    assert.ok(!system.includes("{{"), "no orphan braces reach the prompt");
  } finally {
    removeTestProfile("overlay");
  }
});

test("VANILLA: an overlay on disk changes nothing while no profile is active", () => {
  const baseline = buildSuperAgentSystem({ ...BASE_ARGS, channel: "routine" });
  try {
    installTestProfile("overlay", { prompt: "# Role: Tester\nCORE_MARKER" });
    addChannelOverlay("overlay", "routine", "ROUTINE_ONLY_MARKER");

    assert.equal(
      buildSuperAgentSystem({ ...BASE_ARGS, channel: "routine" }),
      baseline,
      "an inactive profile's overlay must not touch the vanilla prompt"
    );
  } finally {
    removeTestProfile("overlay");
  }
});
