// The persona prompt block, and the invariant that governs the whole subsystem:
//
//   with no persona active, the super-agent prompt is byte-identical to what it
//   was before personas existed.
//
// Everything else in the personas subsystem is reversible. This is not: if a
// vanilla install's prompt drifts, every user who never asked for a persona
// pays for it. See docs-internal/secretary/01-SPEC-personas.md § 9, test 1.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Point APX_HOME at a temp dir BEFORE importing anything that reads it —
// buildSuperAgentSystem calls readIdentity() internally, so without this the
// result depends on whose machine runs the suite.
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-persona-test-"));
process.env.HOME = TMP_HOME;

const { buildSuperAgentSystem } = await import("#core/agent/prompt-builder.js");
const { buildPersonaBlock, renderPersonaPrompt, clearPersonaBlockCache } =
  await import("#core/personas/block.js");
const { readPersona, listPersonas } = await import("#core/personas/store.js");
const { PERSONAS_DIR } = await import("#core/personas/paths.js");

// --------------------------------------------------------------------------

const IDENTITY = { agent_name: "Nova", owner_name: "Ada", language: "en" };

const BASE_ARGS = {
  globalConfig: { user: { language: "en" } },
  projects: [],
  listSkills: () => [],
  channel: "telegram",
  channelMeta: {},
};

/** Write a persona package into the user layer of the temp home. */
function installTestPersona(id, { prompt, manifest = {}, schema = null, lang = null } = {}) {
  const dir = path.join(PERSONAS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "persona.json"),
    JSON.stringify({ id, name: id, version: "1.0.0", ...manifest }, null, 2)
  );
  const file = lang ? `PERSONA.${lang}.md` : "PERSONA.md";
  fs.writeFileSync(path.join(dir, file), prompt);
  if (schema) {
    fs.writeFileSync(path.join(dir, "config.schema.json"), JSON.stringify(schema, null, 2));
  }
  clearPersonaBlockCache();
  return dir;
}

function removeTestPersona(id) {
  fs.rmSync(path.join(PERSONAS_DIR, id), { recursive: true, force: true });
  clearPersonaBlockCache();
}

// --------------------------------------------------------------------------
// The invariant
// --------------------------------------------------------------------------

test("VANILLA: no persona key at all produces a prompt with no persona content", () => {
  const system = buildSuperAgentSystem(BASE_ARGS);
  assert.ok(system.length > 0);
  assert.ok(!system.includes("{{"), "no unrendered template variables");
});

test("VANILLA: every 'no persona' config shape yields the identical prompt", () => {
  const baseline = buildSuperAgentSystem(BASE_ARGS);

  const shapes = [
    { user: { language: "en" } },                      // key absent
    { user: { language: "en" }, persona: null },       // key null
    { user: { language: "en" }, persona: {} },         // object, no active
    { user: { language: "en" }, persona: { active: null } },
    { user: { language: "en" }, persona: { active: "" } },
    { user: { language: "en" }, persona: { active: "does-not-exist" } },
  ];

  for (const globalConfig of shapes) {
    assert.equal(
      buildSuperAgentSystem({ ...BASE_ARGS, globalConfig }),
      baseline,
      `prompt drifted for config ${JSON.stringify(globalConfig.persona)}`
    );
  }
});

// The real regression risk: a package sitting on disk changing the prompt of
// someone who never activated it.
test("VANILLA: an installed-but-inactive persona does not touch the prompt", () => {
  const baseline = buildSuperAgentSystem(BASE_ARGS);
  try {
    installTestPersona("dormant", { prompt: "# Role: Dormant\nYou should not appear." });

    assert.equal(
      buildSuperAgentSystem(BASE_ARGS),
      baseline,
      "installing a persona changed the prompt of a vanilla install"
    );
    assert.ok(!buildSuperAgentSystem(BASE_ARGS).includes("Dormant"));
  } finally {
    removeTestPersona("dormant");
  }
});

test("buildPersonaBlock returns empty string for every inactive shape", () => {
  for (const cfg of [undefined, {}, { persona: null }, { persona: { active: null } }]) {
    assert.equal(buildPersonaBlock(IDENTITY, cfg), "");
  }
});

// --------------------------------------------------------------------------
// Injection
// --------------------------------------------------------------------------

test("an active persona is injected between identity and custom instructions", () => {
  try {
    installTestPersona("tester", { prompt: "# Role: Tester\nPERSONA_MARKER" });

    const globalConfig = {
      user: { language: "en" },
      super_agent: { instructions: "CUSTOM_MARKER" },
      persona: { active: "tester", config: {} },
    };
    const system = buildSuperAgentSystem({ ...BASE_ARGS, globalConfig });

    assert.ok(system.includes("PERSONA_MARKER"), "persona block missing");

    const identityAt = system.indexOf("# Agent profile");
    const personaAt = system.indexOf("PERSONA_MARKER");
    const customAt = system.indexOf("CUSTOM_MARKER");

    assert.ok(identityAt >= 0 && personaAt >= 0 && customAt >= 0);
    assert.ok(identityAt < personaAt, "persona must come after the identity block");
    assert.ok(
      personaAt < customAt,
      "custom instructions must come after the persona so the user wins on recency"
    );
  } finally {
    removeTestPersona("tester");
  }
});

test("deactivating restores the vanilla prompt exactly", () => {
  const baseline = buildSuperAgentSystem(BASE_ARGS);
  try {
    installTestPersona("tester", { prompt: "# Role: Tester\nPERSONA_MARKER" });

    const on = buildSuperAgentSystem({
      ...BASE_ARGS,
      globalConfig: { user: { language: "en" }, persona: { active: "tester" } },
    });
    assert.ok(on.includes("PERSONA_MARKER"));

    const off = buildSuperAgentSystem({
      ...BASE_ARGS,
      globalConfig: { user: { language: "en" }, persona: { active: null } },
    });
    assert.equal(off, baseline, "turning a persona off must restore vanilla byte-for-byte");
  } finally {
    removeTestPersona("tester");
  }
});

// --------------------------------------------------------------------------
// Rendering
// --------------------------------------------------------------------------

test("template variables resolve from persona config and identity", () => {
  try {
    installTestPersona("vars", {
      prompt: "Owner is {{owner_name}}. Budget {{nudge_budget_per_day}}. Agent {{agent_name}}.",
      schema: { type: "object", properties: { nudge_budget_per_day: { type: "integer", default: 3 } } },
    });

    const block = buildPersonaBlock(IDENTITY, {
      persona: { active: "vars", config: { nudge_budget_per_day: 7 } },
    });

    assert.match(block, /Owner is Ada\./, "owner_name comes from identity.json");
    assert.match(block, /Budget 7\./, "saved config wins over the schema default");
    assert.match(block, /Agent Nova\./);
  } finally {
    removeTestPersona("vars");
  }
});

test("schema defaults fill in settings the user never configured", () => {
  try {
    installTestPersona("defaults", {
      prompt: "Quiet hours {{quiet_hours}}.",
      schema: { type: "object", properties: { quiet_hours: { type: "string", default: "22:00-07:30" } } },
    });

    const block = buildPersonaBlock(IDENTITY, { persona: { active: "defaults", config: {} } });
    assert.match(block, /Quiet hours 22:00-07:30\./);
  } finally {
    removeTestPersona("defaults");
  }
});

// A visible {{…}} in the prompt is a severity-high bug (spec § 8). Neither a
// missing value nor a variable the renderer cannot parse may leak braces.
test("no orphan {{...}} survives, and a missing owner falls back to neutral prose", () => {
  try {
    installTestPersona("orphans", {
      prompt: "You are {{owner_name}}'s assistant. {{persona.name}} {{never_declared}} end.",
    });

    const block = buildPersonaBlock({ agent_name: "Nova" }, { persona: { active: "orphans" } });

    assert.ok(!block.includes("{{"), `orphan braces survived: ${block}`);
    assert.match(block, /You are the owner's assistant\./, "neutral fallback for owner_name");
    assert.match(block, /end\.$/);
  } finally {
    removeTestPersona("orphans");
  }
});

test("language selection prefers PERSONA.<lang>.md and falls back to English", () => {
  try {
    const dir = installTestPersona("multi", { prompt: "ENGLISH BODY" });
    fs.writeFileSync(path.join(dir, "PERSONA.es.md"), "CUERPO EN ESPANOL");
    clearPersonaBlockCache();

    const es = buildPersonaBlock(
      { ...IDENTITY, language: "es" },
      { user: { language: "es" }, persona: { active: "multi" } }
    );
    assert.match(es, /CUERPO EN ESPANOL/);

    const fr = buildPersonaBlock(
      { ...IDENTITY, language: "fr" },
      { user: { language: "fr" }, persona: { active: "multi" } }
    );
    assert.match(fr, /ENGLISH BODY/, "an unsupported language degrades to English");
  } finally {
    removeTestPersona("multi");
  }
});

test("a persona with no readable prompt file yields an empty block, not a crash", () => {
  const dir = path.join(PERSONAS_DIR, "empty");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "persona.json"),
    JSON.stringify({ id: "empty", name: "Empty", version: "1.0.0" })
  );
  clearPersonaBlockCache();
  try {
    assert.equal(buildPersonaBlock(IDENTITY, { persona: { active: "empty" } }), "");
  } finally {
    removeTestPersona("empty");
  }
});

// --------------------------------------------------------------------------
// Store
// --------------------------------------------------------------------------

test("listPersonas surfaces bundled packages and readPersona resolves them", () => {
  const all = listPersonas();
  assert.ok(Array.isArray(all));
  for (const p of all) {
    assert.ok(p.id && p.manifest, "every listed persona resolves to a manifest");
    assert.ok(["bundled", "user", "user-override"].includes(p.source));
  }
});

test("a user package overrides a bundled one of the same id", () => {
  const bundled = listPersonas().find((p) => p.source === "bundled");
  if (!bundled) return; // no bundled personas yet — nothing to assert
  try {
    installTestPersona(bundled.id, { prompt: "OVERRIDDEN" });
    const resolved = readPersona(bundled.id);
    assert.equal(resolved.source, "user-override");
    assert.match(
      renderPersonaPrompt(resolved, { identity: IDENTITY }),
      /OVERRIDDEN/
    );
  } finally {
    removeTestPersona(bundled.id);
  }
});
