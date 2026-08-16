import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadDefaultSystemPrompt,
  buildUserContextBlock,
  buildChannelContextBlock,
  buildSuperAgentSystem,
  buildProjectAgentsBlock,
  PROJECT_AGENTS_MAX_CHARS,
  renderPromptTemplate,
} from "#core/agent/prompt-builder.js";

function tmpProjectWithAgentsMd(contents) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apx-pb-agents-"));
  fs.writeFileSync(path.join(root, "AGENTS.md"), contents);
  return root;
}

test("loadDefaultSystemPrompt: base prompt has no hardcoded owner names", () => {
  const base = loadDefaultSystemPrompt();
  assert.ok(!/Manuel/i.test(base), "base prompt must not contain hardcoded owner name");
  assert.ok(!/rioplatense/i.test(base), "base prompt must not hardcode dialect");
  // Base prompt (agent-base + super-agent role) doesn't render identity itself
  // — identity is layered later as the "Agent profile" block. Just check the
  // base doesn't leak personal details and DOES tell the agent where its name
  // comes from.
  assert.match(base, /display name/i);
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
  assert.match(block, /Telegram/i);
  assert.match(block, /default/);
  assert.match(block, /alice/);
  assert.match(block, /12345/);
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
      super_agent: { model: "mock:mock", permission_mode: "auto", allowed_tools: [] },
      user: { language: "en" },
    },
    projects,
    listSkills: () => [],
    channel: "cli",
    channelMeta: { cwd: "/tmp/work" },
  });
  // After the refactor the super-agent role lives in core/super-agent.md.
  // It identifies the agent as the always-on voice for an APX install.
  assert.match(system, /always-on/i);
  assert.match(system, /APX/);
  assert.match(system, /# Agent profile/);
  assert.match(system, /cli/i); // channel content
  assert.ok(system.includes("/tmp/work"));
  assert.ok(!system.includes("Manuel"));
});

test("buildProjectAgentsBlock: empty for no path, missing file, or blank file", () => {
  assert.equal(buildProjectAgentsBlock(null), "");
  assert.equal(buildProjectAgentsBlock("/no/such/dir/anywhere"), "");
  const root = tmpProjectWithAgentsMd("   \n  ");
  try {
    assert.equal(buildProjectAgentsBlock(root), "");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("buildProjectAgentsBlock: loads + labels the project's AGENTS.md", () => {
  const root = tmpProjectWithAgentsMd("# AGENTS.md\n\nAlways write tests.\n");
  try {
    const block = buildProjectAgentsBlock(root);
    assert.match(block, /# Project guidance \(AGENTS\.md\)/);
    assert.match(block, /Always write tests\./);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("buildProjectAgentsBlock: size-caps oversized FOREIGN files with a truncation note", () => {
  const big = "x".repeat(PROJECT_AGENTS_MAX_CHARS + 500);
  const root = tmpProjectWithAgentsMd(big);
  try {
    const block = buildProjectAgentsBlock(root);
    assert.match(block, /AGENTS\.md truncated/);
    assert.match(block, /characters omitted/, "says how much was dropped");
    assert.ok(block.length < big.length + 400, "content should be capped");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Regression: APX sliced any AGENTS.md at 6000 chars — including the one for
// the project it was running inside. Our own contract is 16k+, so 63% of it
// never reached the agent and the cut landed mid-rule. A project must always
// read its own contract whole.
test("buildProjectAgentsBlock: never truncates the project APX is running inside", () => {
  const big = "# AGENTS.md\n\n" + "rule line\n".repeat(4000); // ~40k chars
  const root = tmpProjectWithAgentsMd(big);
  const cwd = process.cwd();
  try {
    process.chdir(root);
    // fs.realpathSync: macOS temp dirs are symlinked via /var → /private/var,
    // so compare on the resolved path the process actually reports.
    const block = buildProjectAgentsBlock(process.cwd());
    assert.ok(!/truncated/.test(block), "own project must not be truncated");
    assert.ok(block.length > big.length, "full contract reaches the prompt");
  } finally {
    process.chdir(cwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("buildProjectAgentsBlock: config can raise or disable the foreign cap", () => {
  const big = "x".repeat(PROJECT_AGENTS_MAX_CHARS + 500);
  const root = tmpProjectWithAgentsMd(big);
  try {
    const uncapped = buildProjectAgentsBlock(root, {
      super_agent: { project_agents_max_chars: 0 },
    });
    assert.ok(!/truncated/.test(uncapped), "0 disables the cap");

    const tight = buildProjectAgentsBlock(root, {
      super_agent: { project_agents_max_chars: 100 },
    });
    assert.match(tight, /AGENTS\.md truncated/);
    assert.ok(tight.length < uncapped.length, "a smaller cap keeps less text");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// A contract severed mid-sentence is worse than a short one: the agent cannot
// tell that the rule it is reading was cut in half.
test("buildProjectAgentsBlock: truncation lands on a line boundary", () => {
  const body = "# AGENTS.md\n" + "a rule that must stay whole\n".repeat(200);
  const root = tmpProjectWithAgentsMd(body);
  try {
    const block = buildProjectAgentsBlock(root, {
      super_agent: { project_agents_max_chars: 500 },
    });
    const kept = block.split("…(AGENTS.md truncated")[0].trimEnd();
    const lastLine = kept.slice(kept.lastIndexOf("\n") + 1);
    assert.ok(
      lastLine === "# AGENTS.md" || lastLine === "a rule that must stay whole",
      `expected a whole line, got: ${JSON.stringify(lastLine)}`
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("buildSuperAgentSystem: injects project AGENTS.md when channelMeta.projectPath has one", () => {
  const root = tmpProjectWithAgentsMd("# AGENTS.md\n\nProject rule: be terse.\n");
  try {
    const projects = { list: () => [{ id: 0, name: "default", path: "/tmp/default" }] };
    const base = {
      globalConfig: { super_agent: { model: "mock:mock", permission_mode: "automatico", allowed_tools: [] }, user: { language: "en" } },
      projects,
      listSkills: () => [],
      channel: "web",
    };
    const withProject = buildSuperAgentSystem({ ...base, channelMeta: { projectPath: root } });
    assert.match(withProject, /# Project guidance \(AGENTS\.md\)/);
    assert.match(withProject, /Project rule: be terse\./);
    // Ordered after the projects index, before the skills catalog.
    assert.ok(
      withProject.indexOf("Registered projects") < withProject.indexOf("# Project guidance (AGENTS.md)")
    );

    const withoutProject = buildSuperAgentSystem({ ...base, channelMeta: {} });
    assert.doesNotMatch(withoutProject, /# Project guidance \(AGENTS\.md\)/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("renderPromptTemplate: replaces {{vars}}", () => {
  assert.equal(renderPromptTemplate("hi {{name}}", { name: "Ada" }), "hi Ada");
  assert.equal(renderPromptTemplate("hi {{missing}}", {}), "hi ");
});

// Channel template renders project pin + route-to-agent blocks when present
// and silently omits them when absent. Tracked in spec/done backlog for
// Fase C (channel↔project spawn announce).
test("telegram channel template includes project pin when present", async () => {
  const { buildChannelContextBlock } = await import("#core/agent/prompt-builder.js");
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
  const { buildChannelContextBlock } = await import("#core/agent/prompt-builder.js");
  const out = buildChannelContextBlock("telegram", {
    channelName: "default",
    author: "Manú",
    chatId: "1234",
  });
  assert.equal(/Project pin/.test(out), false);
  assert.equal(/Master agent/.test(out), false);
  // Still has the base channel header.
  assert.match(out, /Telegram/i);
});

test("telegram channel template includes master agent block when set", async () => {
  const { buildChannelContextBlock } = await import("#core/agent/prompt-builder.js");
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
