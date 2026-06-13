#!/usr/bin/env node
// Channel prompt dumper — writes one .md file per channel under
// `tmp/channel-prompts/<channel>.md` with EVERYTHING the super-agent receives
// at turn start: the assembled system prompt + the tool schemas it can call +
// the lazy on-demand pool + skills available.
//
// Goal: see at a glance what each channel costs (tokens / chars) and decide
// what should be loaded eagerly vs. what should stay lazy.
//
// Usage:
//   node scripts/dump-channel-prompts.js                  # writes all channels
//   node scripts/dump-channel-prompts.js telegram code    # only the given ones
//
// Output:
//   tmp/channel-prompts/<channel>.md
//   tmp/channel-prompts/_summary.md   <-- comparison table across channels
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildSuperAgentSystem,
  buildChannelContextBlock,
} from "../src/core/agent/prompt-builder.js";
import { buildAgentSystem } from "../src/core/agent/build-agent-system.js";
import {
  TOOL_SCHEMAS,
  createToolSession,
  buildLazyToolsBlock,
} from "../src/core/agent/tools/registry.js";
import { listSkills } from "../src/core/agent/skills/loader.js";
import { readConfig, mergeDefaults } from "../src/core/config/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "..", "tmp", "channel-prompts");

// ---- token estimator: chars/4, good enough for relative comparison ---------
const tok = (s) => Math.round((typeof s === "string" ? s.length : 0) / 4);
const schemaTok = (schemas) =>
  schemas.reduce((acc, s) => acc + tok(JSON.stringify(s)), 0);

// ---- channels we want to see ----------------------------------------------
// channelMeta mirrors what the real callers pass (telegram plugin, voice api,
// code api, etc). When a channel has variants (e.g. deck in voice mode), they
// get their own row in the dump so they can be compared.
const CHANNELS = {
  telegram: {
    use: "Telegram bot — chit-chat + actions, lightweight tool set",
    meta: {
      channelName: "roby-bot",
      author: "Manu",
      chatId: "123456789",
      projectBlock: "Active project: apx (id=0).\n",
      routeBlock: "",
    },
    relationship:
      "# Who you're talking to\nYou are talking to your owner, Manu.",
  },
  cli: {
    use: "`apx exec super-agent` — one-shot terminal call",
    meta: { cwd: process.cwd() },
  },
  code: {
    use: "`apx code` — terminal coding session, FULL tools + plan/build mode",
    meta: { cwd: process.cwd(), mode: "build", projectId: 0, projectPath: "~/.apx/projects/default" },
  },
  api: {
    use: "Generic /super-agent/chat HTTP caller, FULL tools",
    meta: { projectId: 0, projectName: "default", projectPath: "~/.apx/projects/default" },
  },
  web: {
    use: "Web admin big chat — long-form workspace, FULL tools",
    meta: { projectId: 0, projectName: "default", projectPath: "~/.apx/projects/default" },
  },
  web_sidebar: {
    use: "Web admin docked sidebar — quick chat, BASE tools",
    meta: {},
  },
  web_code: {
    use: "Web admin /m/code — OpenCode-style coding surface, FULL tools",
    meta: { projectId: 0, projectName: "default", projectPath: "~/.apx/projects/default", mode: "build" },
  },
  deck: {
    use: "Cockpit dashboard — action chips, suggestions JSON suffix",
    meta: {},
    suffix:
      "Always end with a ```suggestions\\n[...]\\n``` JSON block of 2-4 next actions.",
  },
  "deck+voice": {
    use: "Deck in voice mode (channelMeta.voice=true) — reply read aloud",
    channel: "deck",
    meta: { voice: true },
    suffix:
      "Always end with a ```suggestions\\n[...]\\n``` JSON block of 2-4 next actions.",
  },
  desktop: {
    use: "PC floating capsule — voice-first, action-oriented",
    channel: "desktop",
    meta: { voice: true },
  },
  routine: {
    use: "Autonomous scheduled run — FULL tool registry",
    meta: { routineName: "daily-standup", projectPath: "~/projects/foo" },
  },
};

const projects = {
  list: () => [{ id: 0, name: "default", path: "~/.apx/projects/default" }],
};

// ---- project agent (April) — what a dedicated project agent receives --------
// The super-agent (Roby) is built by buildSuperAgentSystem; a project agent is
// built by buildAgentSystem and looks quite different (project-agent role,
// agent profile, the agent's authored body as "Custom instructions", per-agent
// memory, invocation context). This is a representative stub mirroring a real
// `.apc/agents/<slug>.md` so the dump is deterministic regardless of disk state.
// storagePath is set so per-agent memory resolution skips apx-id lookup on disk
// (the dump is deterministic — no memory.md exists at this path, so the agent
// renders with an empty memory block, same as a brand-new agent).
const SAMPLE_PROJECT = {
  id: 0,
  name: "default",
  path: "~/.apx/projects/default",
  storagePath: path.join(OUT_DIR, ".sample-storage"),
};
const SAMPLE_AGENT = {
  slug: "april",
  fields: {
    Description: "APC/APX social presence on Moltbook. Posts and engages with the community.",
    Role: "Community / social",
    Language: "en",
    Tools: ["http_get", "http_post"],
  },
  body: [
    "# April",
    "",
    "You are April, the Moltbook presence for Agent Project Context (APC/APX) —",
    "an open standard that gives AI agent projects a shared, readable context file.",
    "Participate genuinely. Share ideas, comment on relevant posts. Never spam.",
    "",
    "## Tone",
    "Curious, direct, a bit nerdy. Mention APC only when genuinely relevant.",
    "",
    "## Hard limits",
    "- 1 post / 30 min minimum gap (prefer 24h between posts)",
    "- Max 50 comments/day",
  ].join("\n"),
};

// Surfaces a project agent actually answers through. Unlike the super-agent it
// has no APX tool registry of its own — callable tools come from the invocation
// surface / external runtime — so these dumps show the system prompt only.
const AGENT_SURFACES = {
  engine: {
    use: "`call_agent` — direct LLM engine call, no user surface",
    invocation: "engine",
  },
  telegram: {
    use: "Project agent answering its owner on Telegram",
    invocation: "telegram",
    channel: "telegram",
    meta: { channelName: "april-bot", author: "Manu", chatId: "123456789" },
    sender: { userId: 1, name: "Manu", isOwner: true, role: "owner" },
  },
  deck: {
    use: "Project agent on the cockpit deck",
    invocation: "engine",
    channel: "deck",
    meta: {},
  },
  routine: {
    use: "Project agent run by a scheduled routine",
    invocation: "routine",
    channel: "routine",
    routine: "daily-moltbook",
    meta: { routineName: "daily-moltbook" },
  },
};

function loadCfg() {
  try {
    const cfg = mergeDefaults(readConfig());
    if (!cfg.super_agent) cfg.super_agent = {};
    if (!cfg.super_agent.model) cfg.super_agent.model = "(stub)";
    return { cfg, real: true };
  } catch {
    return {
      real: false,
      cfg: {
        super_agent: { model: "(stub)", permission_mode: "automatico", allowed_tools: [] },
        user: {
          language: "es",
          locale: "es-AR",
          timezone: "America/Argentina/Buenos_Aires",
        },
      },
    };
  }
}

function buildFor(channel, spec, cfg) {
  return buildSuperAgentSystem({
    globalConfig: cfg,
    projects,
    listSkills,
    channel: spec.channel || channel,
    channelMeta: spec.meta,
    relationshipBlock: spec.relationship || "",
    systemSuffix: spec.suffix || "",
  });
}

function getSession(channel, spec) {
  return createToolSession(spec.channel || channel, { full: false });
}

function renderToolTable(toolSchemas) {
  if (!toolSchemas.length) return "_none_\n";
  const lines = [
    "| # | tool | tokens | description |",
    "|---|---|---|---|",
  ];
  toolSchemas.forEach((s, i) => {
    const name = s?.function?.name || s?.name || "?";
    const desc = (s?.function?.description || "").replace(/\s+/g, " ").trim();
    const short = desc.length > 100 ? desc.slice(0, 97) + "…" : desc;
    lines.push(`| ${i + 1} | \`${name}\` | ${tok(JSON.stringify(s))} | ${short} |`);
  });
  return lines.join("\n") + "\n";
}

function renderLazyToolTable(notLoaded) {
  if (!notLoaded.length) return "_none — every tool is already loaded_\n";
  const lines = [
    "| # | tool | category | description |",
    "|---|---|---|---|",
  ];
  notLoaded.forEach((m, i) => {
    const desc = (m.description || "").replace(/\s+/g, " ").trim();
    const short = desc.length > 100 ? desc.slice(0, 97) + "…" : desc;
    lines.push(`| ${i + 1} | \`${m.name}\` | ${m.category} | ${short} |`);
  });
  return lines.join("\n") + "\n";
}

function dumpChannel(channelKey, spec, cfg, skills) {
  const sys = buildFor(channelKey, spec, cfg);
  const session = getSession(channelKey, spec);
  const loaded = session.initialSchemas;
  const notLoaded = session.notLoaded();
  const lazyBlock = buildLazyToolsBlock(session);

  const sysChars = sys.length;
  const sysTok = tok(sys);
  const loadedTok = schemaTok(loaded);
  const notLoadedTok = schemaTok(notLoaded.map((m) => m.schema));
  const totalSentTok = sysTok + loadedTok;

  const channelBlock = buildChannelContextBlock(spec.channel || channelKey, spec.meta);
  const channelChars = channelBlock ? channelBlock.length : 0;

  const md = [
    `# Channel: \`${channelKey}\``,
    "",
    `> ${spec.use}`,
    "",
    "## Stats — what hits the wire on turn 1",
    "",
    "| metric | value |",
    "|---|---|",
    `| system prompt | ${sysChars.toLocaleString()} chars · ≈${sysTok.toLocaleString()} tokens |`,
    `| tool schemas (loaded) | ≈${loadedTok.toLocaleString()} tokens · ${loaded.length} tools |`,
    `| **total payload on turn 1** | **≈${totalSentTok.toLocaleString()} tokens** |`,
    `| on-demand pool (lazy) | ≈${notLoadedTok.toLocaleString()} tokens · ${notLoaded.length} tools |`,
    `| channel-context block (channels/${spec.channel || channelKey}.md) | ${channelChars} chars |`,
    `| lazy-tools hint block (in system) | ${lazyBlock.length} chars |`,
    "",
    `Lazy ratio: **${notLoaded.length}** of **${TOOL_SCHEMAS.length}** tools wait for \`discover_tools\` (${Math.round((notLoaded.length / TOOL_SCHEMAS.length) * 100)}%).`,
    "",
    "---",
    "",
    "## 1. Full system prompt",
    "",
    "```text",
    sys,
    "```",
    "",
    "---",
    "",
    `## 2. Tools loaded on turn 1 (${loaded.length})`,
    "",
    "Every one of these adds tokens to every turn whether the model uses them or not.",
    "",
    renderToolTable(loaded),
    "",
    "---",
    "",
    `## 3. Tools available on-demand (${notLoaded.length})`,
    "",
    "The model has to call `discover_tools` to reveal these — they cost zero tokens until that happens.",
    "",
    renderLazyToolTable(notLoaded),
    "",
    "---",
    "",
    `## 4. Skills available (${skills.length})`,
    "",
    "Only the slug + 1-line description appear in the system prompt. The skill body is loaded on `/skill-slug` trigger or via the `load_skill` tool.",
    "",
    skills.length
      ? skills
          .map((s) => `- \`/${s.slug}\` — ${(s.description || "").replace(/\s+/g, " ").trim()}`)
          .join("\n")
      : "_no skills discovered (project has no .apc/skills/ + no global skills installed)_",
    "",
  ].join("\n");

  return {
    md,
    summary: {
      channel: channelKey,
      sysTok,
      loadedTok,
      totalSentTok,
      notLoadedTok,
      tools_loaded: loaded.length,
      tools_lazy: notLoaded.length,
      tools_total: TOOL_SCHEMAS.length,
    },
  };
}

function dumpAgent(key, spec, cfg) {
  const sys = buildAgentSystem(SAMPLE_PROJECT, SAMPLE_AGENT, {
    invocation: spec.invocation || "engine",
    channel: spec.channel || null,
    channelMeta: spec.meta || {},
    sender: spec.sender || null,
    routine: spec.routine || null,
    globalConfig: cfg,
  });
  const md = [
    `# Project agent: \`${SAMPLE_AGENT.slug}\` — surface \`${key}\``,
    "",
    `> ${spec.use}`,
    "",
    "_Representative stub agent (mirrors a real `.apc/agents/<slug>.md`). A project",
    "agent gets its callable tools from the invocation surface / external runtime,",
    "not the APX tool registry, so there are no tool tables here — only the prompt._",
    "",
    "## Stats",
    "",
    "| metric | value |",
    "|---|---|",
    `| system prompt | ${sys.length.toLocaleString()} chars · ≈${tok(sys).toLocaleString()} tokens |`,
    `| invocation | ${spec.invocation || "engine"} |`,
    `| channel | ${spec.channel || "— (none)"} |`,
    "",
    "---",
    "",
    "## Full system prompt",
    "",
    "```text",
    sys,
    "```",
    "",
  ].join("\n");
  return { md, sysTok: tok(sys) };
}

function renderSummary(rows, real) {
  const lines = [
    "# Channel-prompts comparison",
    "",
    real
      ? "_Loaded REAL `~/.apx/config.json` so super_agent.system + user.\\* are your real values._"
      : "_No `~/.apx/config.json` found — values rendered from a stub._",
    "",
    "| channel | sys ≈tok | loaded tools | loaded ≈tok | **turn-1 ≈tok** | lazy tools | lazy ≈tok |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...rows.map(
      (r) =>
        `| \`${r.channel}\` | ${r.sysTok.toLocaleString()} | ${r.tools_loaded} | ${r.loadedTok.toLocaleString()} | **${r.totalSentTok.toLocaleString()}** | ${r.tools_lazy} | ${r.notLoadedTok.toLocaleString()} |`
    ),
    "",
    `Tool registry: **${TOOL_SCHEMAS.length}** total. FULL channels (api/web/code/routine) preload everything; lightweight channels start on the BASE set.`,
    "",
    "## How to read this",
    "",
    "- `turn-1 ≈tok` is what every message hits the model with **before** the user's prompt. Lower = cheaper + faster + less cache invalidation.",
    "- `lazy ≈tok` is what `discover_tools` could activate later. It's a budget you only spend if the model actually needs those tools.",
    "- If a channel shows >2k tokens of loaded tools but never uses them, those tools should move to the lazy pool.",
    "- If a channel keeps calling `discover_tools` for the same tool, that tool should be promoted to the loaded set.",
    "",
  ];
  return lines.join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const wantedKeys = args.filter((a) => !a.startsWith("--"));
  const targets =
    wantedKeys.length === 0
      ? Object.keys(CHANNELS)
      : wantedKeys.filter((k) => {
          if (CHANNELS[k]) return true;
          console.error(`skipping unknown channel "${k}"`);
          return false;
        });

  const { cfg, real } = loadCfg();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let skills = [];
  try {
    const out = listSkills(process.cwd());
    skills = Array.isArray(out) ? out : out?.skills || [];
  } catch (e) {
    console.error(`could not list skills: ${e.message}`);
  }

  const rows = [];
  for (const key of targets) {
    const spec = CHANNELS[key];
    const { md, summary } = dumpChannel(key, spec, cfg, skills);
    const file = path.join(OUT_DIR, `${key.replace(/\+/g, "-")}.md`);
    fs.writeFileSync(file, md, "utf8");
    rows.push(summary);
    console.log(`wrote ${path.relative(process.cwd(), file)}  (sys ≈${summary.sysTok}tok · turn1 ≈${summary.totalSentTok}tok)`);
  }

  const summary = renderSummary(rows, real);
  const summaryFile = path.join(OUT_DIR, "_summary.md");
  fs.writeFileSync(summaryFile, summary, "utf8");
  console.log(`\nsummary → ${path.relative(process.cwd(), summaryFile)}`);

  // Project-agent dumps (only on a full run — i.e. no specific channels asked).
  if (wantedKeys.length === 0) {
    const agentDir = path.join(OUT_DIR, "agent");
    fs.mkdirSync(agentDir, { recursive: true });
    console.log("");
    for (const [key, spec] of Object.entries(AGENT_SURFACES)) {
      const { md, sysTok } = dumpAgent(key, spec, cfg);
      const file = path.join(agentDir, `${key}.md`);
      fs.writeFileSync(file, md, "utf8");
      console.log(`wrote ${path.relative(process.cwd(), file)}  (sys ≈${sysTok}tok)`);
    }
  }
}

main();
