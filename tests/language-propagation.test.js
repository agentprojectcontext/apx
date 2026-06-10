// Regression tests for language propagation across wakeup, agent-system, and super-agent.
//
// Bug history:
//   1.15.x moved the user language from identity.language to config.user.language (ISO 639-1).
//   wakeup.js was not updated and kept reading identity.language → always fell back to the
//   system LANG env, causing wake-up messages to come out in the wrong language.
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectLanguage } from "../src/host/daemon/wakeup.js";
import { buildAgentSystem } from "../src/core/agent/build-agent-system.js";
import { makeTempProject, cleanupTempProject } from "./_helpers.js";

// ---------------------------------------------------------------------------
// wakeup.js — detectLanguage
// ---------------------------------------------------------------------------

test("detectLanguage: config.user.language (ISO) is the primary source", () => {
  assert.equal(detectLanguage({}, { user: { language: "es" } }), "Spanish");
  assert.equal(detectLanguage({}, { user: { language: "fr" } }), "French");
  assert.equal(detectLanguage({}, { user: { language: "pt" } }), "Portuguese");
  assert.equal(detectLanguage({}, { user: { language: "en" } }), "English");
});

test("detectLanguage: config.user.language wins over identity.language", () => {
  // This is the exact regression: identity still has an old 'language' field,
  // but config should take precedence.
  const identity = { language: "French" };
  const config = { user: { language: "es" } };
  assert.equal(detectLanguage(identity, config), "Spanish");
});

test("detectLanguage: falls back to identity.language when config has none", () => {
  assert.equal(detectLanguage({ language: "Italian" }, {}), "Italian");
  assert.equal(detectLanguage({ language: "Italian" }, undefined), "Italian");
});

test("detectLanguage: unknown ISO code is returned as-is", () => {
  // Future languages not in the map should still propagate, not silently drop.
  assert.equal(detectLanguage({}, { user: { language: "sw" } }), "sw");
});

test("detectLanguage: defaults to English with no config, no identity, no LANG env", () => {
  const saved = { LANG: process.env.LANG, LC_MESSAGES: process.env.LC_MESSAGES, LC_ALL: process.env.LC_ALL };
  delete process.env.LANG;
  delete process.env.LC_MESSAGES;
  delete process.env.LC_ALL;
  try {
    assert.equal(detectLanguage({}, {}), "English");
  } finally {
    if (saved.LANG !== undefined) process.env.LANG = saved.LANG;
    if (saved.LC_MESSAGES !== undefined) process.env.LC_MESSAGES = saved.LC_MESSAGES;
    if (saved.LC_ALL !== undefined) process.env.LC_ALL = saved.LC_ALL;
  }
});

// ---------------------------------------------------------------------------
// agent-system.js — buildAgentSystem Language field
// ---------------------------------------------------------------------------

test("buildAgentSystem: includes agent Language field in system prompt", () => {
  const root = makeTempProject({
    agents: [{ slug: "roby", model: "ollama:llama3", language: "Spanish" }],
  });
  try {
    const agent = { slug: "roby", fields: { Language: "Spanish", Model: "ollama:llama3" } };
    const project = { path: root, name: "test" };
    const system = buildAgentSystem(project, agent);
    assert.ok(system.includes("Default language: Spanish"),
      `expected 'Default language: Spanish' in system prompt, got:\n${system.slice(0, 400)}`);
  } finally {
    cleanupTempProject(root);
  }
});

test("buildAgentSystem: omits language line when agent has no Language field", () => {
  const root = makeTempProject({
    agents: [{ slug: "roby", model: "ollama:llama3" }],
  });
  try {
    const agent = { slug: "roby", fields: { Model: "ollama:llama3" } };
    const project = { path: root, name: "test" };
    const system = buildAgentSystem(project, agent);
    assert.ok(!system.includes("Default language:"),
      "system prompt should not include a language line when field is absent");
  } finally {
    cleanupTempProject(root);
  }
});
