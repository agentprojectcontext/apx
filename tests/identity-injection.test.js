// Regression tests for identity injection into the super-agent system prompt,
// and for the set_identity tool schema.
//
// Bug history:
//   Introduced in 1.15.x: identity fields (name, personality, owner, context)
//   and config.user.language must appear in every super-agent system prompt.
//   If language is not wired correctly the agent replies in the wrong language.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIdentityBlock } from "#host/daemon/super-agent.js";
import { TOOL_SCHEMAS } from "#host/daemon/super-agent-tools/index.js";

// ---------------------------------------------------------------------------
// buildIdentityBlock — pure identity → system prompt section
// ---------------------------------------------------------------------------

test("buildIdentityBlock: includes all fields when populated", () => {
  const block = buildIdentityBlock(
    { agent_name: "Roby", personality: "curioso", owner_name: "tecnomanu", owner_context: "builds AI tools" },
    "es"
  );
  assert.ok(block.includes("Your name is Roby."), `missing agent_name in:\n${block}`);
  assert.ok(block.includes("Your personality: curioso."), `missing personality in:\n${block}`);
  assert.ok(block.includes("Your owner is tecnomanu."), `missing owner_name in:\n${block}`);
  assert.ok(block.includes("Owner context: builds AI tools"), `missing owner_context in:\n${block}`);
  assert.ok(block.includes('"es"'), `missing language code in:\n${block}`);
});

test("buildIdentityBlock: uses config.user.language as the language instruction", () => {
  const block = buildIdentityBlock({ agent_name: "X" }, "pt");
  assert.ok(block.includes('"pt"'), `expected ISO code "pt" in:\n${block}`);
  assert.ok(!block.includes('"en"'), `should not contain default "en" when "pt" supplied:\n${block}`);
});

test("buildIdentityBlock: defaults to 'en' when no userLang supplied", () => {
  const block = buildIdentityBlock({});
  assert.ok(block.includes('"en"'), `expected default "en" in:\n${block}`);
});

test("buildIdentityBlock: identity null does not throw, emits language line", () => {
  assert.doesNotThrow(() => {
    const block = buildIdentityBlock(null, "fr");
    assert.ok(block.includes('"fr"'), `expected "fr" in:\n${block}`);
  });
});

test("buildIdentityBlock: omits optional lines when identity fields are absent", () => {
  const block = buildIdentityBlock({}, "en");
  assert.ok(!block.includes("Your name is"), "should not have agent_name line");
  assert.ok(!block.includes("Your personality:"), "should not have personality line");
  assert.ok(!block.includes("Your owner is"), "should not have owner_name line");
  assert.ok(!block.includes("Owner context:"), "should not have owner_context line");
});

test("buildIdentityBlock: owner_context is included and not confused with owner_name", () => {
  const block = buildIdentityBlock({ owner_name: "alice", owner_context: "fintech startup" }, "en");
  assert.ok(block.includes("Owner context: fintech startup"), `missing owner_context in:\n${block}`);
  assert.ok(block.includes("Your owner is alice."), `missing owner_name in:\n${block}`);
});

test("buildIdentityBlock: language line always present regardless of identity content", () => {
  for (const lang of ["es", "en", "zh", "ar"]) {
    const block = buildIdentityBlock(null, lang);
    assert.ok(block.includes(`"${lang}"`), `language "${lang}" missing from block:\n${block}`);
  }
});

// ---------------------------------------------------------------------------
// set_identity tool schema — owner_context present, language absent
// ---------------------------------------------------------------------------

test("set_identity schema: has owner_context parameter", () => {
  const schema = TOOL_SCHEMAS.find((t) => t.function.name === "set_identity");
  assert.ok(schema, "set_identity tool must exist");
  const props = schema.function.parameters.properties;
  assert.ok("owner_context" in props, "owner_context must be a parameter");
  assert.match(
    props.owner_context.description,
    /system prompt|context|injected/i,
    "owner_context description should mention system prompt injection"
  );
});

test("set_identity schema: does NOT have language parameter (language lives in config)", () => {
  // Regression: before 1.15.x identity had a language field. It was removed to
  // avoid divergence with config.user.language. The tool must not re-introduce it.
  const schema = TOOL_SCHEMAS.find((t) => t.function.name === "set_identity");
  assert.ok(schema, "set_identity tool must exist");
  const props = schema.function.parameters.properties;
  assert.ok(!("language" in props), "set_identity must NOT expose a language parameter");
});

test("set_identity schema: has standard identity fields", () => {
  const schema = TOOL_SCHEMAS.find((t) => t.function.name === "set_identity");
  const props = schema.function.parameters.properties;
  for (const field of ["agent_name", "owner_name", "personality"]) {
    assert.ok(field in props, `missing expected field: ${field}`);
  }
});
