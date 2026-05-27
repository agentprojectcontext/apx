import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadDefaultSystemPrompt,
  buildUserContextBlock,
  buildChannelContextBlock,
  buildSuperAgentSystem,
  renderPromptTemplate,
} from "../src/core/agent/prompt-builder.js";

test("loadDefaultSystemPrompt: base prompt has no hardcoded owner names", () => {
  const base = loadDefaultSystemPrompt();
  assert.ok(!/Manuel/i.test(base), "base prompt must not contain hardcoded owner name");
  assert.ok(!/rioplatense/i.test(base), "base prompt must not hardcode dialect");
  assert.ok(base.includes("User & identity"), "base should reference dynamic identity section");
});

test("buildUserContextBlock: injects language, locale, and timezone from config", () => {
  const block = buildUserContextBlock(
    { agent_name: "Ada", owner_name: "Sam" },
    { user: { language: "es", locale: "es-AR", timezone: "America/Argentina/Buenos_Aires" } }
  );
  assert.ok(block.includes("Your name is Ada."));
  assert.ok(block.includes("Your owner is Sam."));
  assert.ok(block.includes('"es"'));
  assert.ok(block.includes("es-AR"));
  assert.ok(block.includes("America/Argentina/Buenos_Aires"));
});

test("buildChannelContextBlock: telegram template substitutes metadata", () => {
  const block = buildChannelContextBlock("telegram", {
    channelName: "default",
    author: "alice",
    chatId: "12345",
  });
  assert.ok(block.includes("telegram"));
  assert.ok(block.includes("default"));
  assert.ok(block.includes("alice"));
  assert.ok(block.includes("12345"));
});

test("buildChannelContextBlock: unknown channel returns empty string", () => {
  assert.equal(buildChannelContextBlock("unknown"), "");
});

test("buildSuperAgentSystem: composes base + user + channel layers", () => {
  const projects = {
    list: () => [{ id: 0, name: "default", path: "/tmp/default" }],
  };
  const system = buildSuperAgentSystem({
    globalConfig: {
      super_agent: { model: "mock:mock", permission_mode: "automatico", allowed_tools: [] },
      user: { language: "en" },
    },
    projects,
    listSkills: () => [],
    channel: "cli",
    channelMeta: { cwd: "/tmp/work" },
  });
  // Base prompt was reworded in AGENTS.md rule 7: "super-agent" is the mode,
  // not the name. The base prompt now identifies the agent as "APX itself".
  assert.ok(system.includes("APX itself"));
  assert.ok(system.includes("super-agent")); // term still appears as mode descriptor
  assert.ok(system.includes("# User & identity"));
  assert.ok(system.includes("Channel: **cli**"));
  assert.ok(system.includes("/tmp/work"));
  assert.ok(!system.includes("Manuel"));
});

test("renderPromptTemplate: replaces {{vars}}", () => {
  assert.equal(renderPromptTemplate("hi {{name}}", { name: "Ada" }), "hi Ada");
  assert.equal(renderPromptTemplate("hi {{missing}}", {}), "hi ");
});

// Channel template renders project pin + route-to-agent blocks when present
// and silently omits them when absent. Tracked in spec/done backlog for
// Fase C (channel↔project spawn announce).
test("telegram channel template includes project pin when present", async () => {
  const { buildChannelContextBlock } = await import("../src/core/agent/prompt-builder.js");
  const out = buildChannelContextBlock("telegram", {
    channelName: "default",
    author: "Manú",
    chatId: "1234",
    projectBlock: "\nProject pin: **iacrmar** (`/x/y`).",
    routeBlock: "",
  });
  assert.match(out, /Project pin/);
  assert.match(out, /iacrmar/);
  assert.equal(/Master agent/.test(out), false);
});

test("telegram channel template omits both blocks when channelMeta has neither", async () => {
  const { buildChannelContextBlock } = await import("../src/core/agent/prompt-builder.js");
  const out = buildChannelContextBlock("telegram", {
    channelName: "default",
    author: "Manú",
    chatId: "1234",
  });
  assert.equal(/Project pin/.test(out), false);
  assert.equal(/Master agent/.test(out), false);
  // Still has the base channel header.
  assert.match(out, /telegram/);
});

test("telegram channel template includes master agent block when set", async () => {
  const { buildChannelContextBlock } = await import("../src/core/agent/prompt-builder.js");
  const out = buildChannelContextBlock("telegram", {
    channelName: "clientes",
    author: "X",
    chatId: "9",
    projectBlock: "",
    routeBlock: "\nMaster agent for this channel: **reviewer**.",
  });
  assert.match(out, /Master agent/);
  assert.match(out, /reviewer/);
});
