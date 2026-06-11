#!/usr/bin/env node
// Channel prompt inspector — shows EXACTLY what the super-agent receives on each
// channel: the assembled system prompt (section by section), its size, and the
// tool schemas that channel is allowed to call.
//
// This is a study/debug tool, not part of the runtime. Run it to compare how
// telegram vs web vs deck vs voice differ in prompt + tools.
//
//   node scripts/inspect-channel-prompts.js              # summary table + per-channel breakdown
//   node scripts/inspect-channel-prompts.js telegram     # full system prompt for one channel
//   node scripts/inspect-channel-prompts.js --full        # full prompt for every channel
//
// It reads your real ~/.apx/config.json + identity if present (so you see the
// real super_agent.system / user block); otherwise it falls back to a stub so
// the script always runs.

import {
  buildSuperAgentSystem,
  buildChannelContextBlock,
} from "../src/core/agent/prompt-builder.js";
import {
  schemasForChannel,
  TOOL_SCHEMAS,
  BASE_TOOL_SCHEMAS,
} from "../src/core/agent/tools/registry.js";
import { listSkills } from "../src/core/agent/skills/loader.js";
import { readConfig, mergeDefaults } from "../src/core/config/index.js";

// ---- rough token estimate (chars/4 — good enough for relative comparison) ----
const tok = (s) => Math.round((s || "").length / 4);

// ---- representative channelMeta per channel (mirrors the real callers) -------
const CHANNELS = {
  telegram: {
    note: "plugins/telegram.js — sender-aware, role-gated tools",
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
  terminal: {
    note: "interactive `apx code` TUI / sys session",
    meta: { cwd: "/Volumes/SSDT7Shield/proyectos_varios/agentprojectcontext/apx" },
  },
  cli: {
    note: "one-shot `apx exec super-agent`",
    meta: { cwd: process.cwd() },
  },
  api: {
    note: "generic HTTP caller / `apx exec super-agent` (FULL tools)",
    meta: { projectId: 0, projectName: "default", projectPath: "~/.apx/projects/default" },
  },
  web: {
    note: "web big chat — long-form workspace, FULL tools",
    meta: { projectId: 0, projectName: "default", projectPath: "~/.apx/projects/default" },
  },
  web_sidebar: {
    note: "web sidebar quick chat — short replies, CORE tools",
    meta: {},
  },
  deck: {
    note: "cockpit dashboard — action chips, suggestions JSON suffix",
    meta: {},
    suffix: "Always end with a ```suggestions\\n[...]\\n``` JSON block of 2-4 next actions.",
  },
  "deck+voice": {
    note: "deck in VOICE MODE (channelMeta.voice=true) — reply read aloud by TTS",
    channel: "deck",
    meta: { voice: true },
    suffix: "Always end with a ```suggestions\\n[...]\\n``` JSON block of 2-4 next actions.",
  },
  desktop: {
    note: "PC floating module (was overlay) — voice-first, action-oriented",
    channel: "desktop",
    meta: { voice: true },
  },
  routine: {
    note: "autonomous scheduled run — FULL tool registry",
    meta: { routineName: "daily-standup", projectPath: "~/projects/foo" },
  },
};

function loadConfig() {
  try {
    const cfg = mergeDefaults(readConfig());
    if (!cfg.super_agent) cfg.super_agent = {};
    // Ensure the agent is "enabled enough" for the builder (it only reads .system).
    if (!cfg.super_agent.model) cfg.super_agent.model = "(stub)";
    return { cfg, real: true };
  } catch {
    return {
      real: false,
      cfg: {
        super_agent: { model: "(stub)", permission_mode: "automatico", allowed_tools: [] },
        user: { language: "es", locale: "es-AR", timezone: "America/Argentina/Buenos_Aires" },
      },
    };
  }
}

const projects = {
  list: () => [{ id: 0, name: "default", path: "~/.apx/projects/default" }],
};

function sectionBreakdown(channel, spec, cfg) {
  // Re-derive the individual blocks the builder concatenates, so we can show
  // the size contribution of each. (Mirrors buildSuperAgentSystem's order.)
  const channelBlock = buildChannelContextBlock(spec.channel || channel, spec.meta);
  return { channelBlock };
}

function toolInfo(channel, spec = {}) {
  const schemas = schemasForChannel(spec.channel || channel);
  const names = schemas.map((s) => s?.function?.name || s?.name).filter(Boolean);
  const isFull = schemas.length === TOOL_SCHEMAS.length;
  return { names, count: schemas.length, set: isFull ? "FULL" : "CORE" };
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
    // memoryBlock intentionally left empty — the broker is runtime/state-dependent.
  });
}

function printSummaryTable(cfg) {
  console.log("\n=== CHANNEL SUMMARY ===");
  console.log(
    "channel".padEnd(10),
    "tools".padEnd(7),
    "set".padEnd(6),
    "sys≈tok".padEnd(8),
    "chan-block".padEnd(11),
    "notes"
  );
  console.log("-".repeat(100));
  for (const [ch, spec] of Object.entries(CHANNELS)) {
    const sys = buildFor(ch, spec, cfg);
    const { count, set } = toolInfo(ch, spec);
    const { channelBlock } = sectionBreakdown(ch, spec, cfg);
    console.log(
      ch.padEnd(10),
      String(count).padEnd(7),
      set.padEnd(6),
      String(tok(sys)).padEnd(8),
      (channelBlock ? `${channelBlock.length}ch` : "—").padEnd(11),
      spec.note
    );
  }
  console.log(
    `\nFULL registry = ${TOOL_SCHEMAS.length} tools · BASE subset = ${BASE_TOOL_SCHEMAS.length} tools`
  );
}

function printChannelDetail(ch, spec, cfg, { full }) {
  const sys = buildFor(ch, spec, cfg);
  const { names, count, set } = toolInfo(ch, spec);
  const { channelBlock } = sectionBreakdown(ch, spec, cfg);
  console.log("\n" + "█".repeat(80));
  console.log(`█ CHANNEL: ${ch}  —  ${spec.note}`);
  console.log("█".repeat(80));
  console.log(`system prompt: ${sys.length} chars ≈ ${tok(sys)} tokens`);
  console.log(`tools (${set} set, ${count}): ${names.join(", ")}`);
  console.log("\n--- channel block (channels/" + ch + ".md, rendered) ---");
  console.log(channelBlock || "(none — this channel injects no channels/*.md block)");
  if (full) {
    console.log("\n--- FULL ASSEMBLED SYSTEM PROMPT ---\n");
    console.log(sys);
  }
}

function main() {
  const args = process.argv.slice(2);
  const full = args.includes("--full");
  const only = args.find((a) => !a.startsWith("--"));
  const { cfg, real } = loadConfig();

  console.log(
    real
      ? "Loaded REAL config from ~/.apx/config.json"
      : "No ~/.apx/config.json — using STUB config"
  );

  if (only) {
    const spec = CHANNELS[only];
    if (!spec) {
      console.error(`Unknown channel "${only}". Options: ${Object.keys(CHANNELS).join(", ")}`);
      process.exit(1);
    }
    printChannelDetail(only, spec, cfg, { full: true });
    return;
  }

  printSummaryTable(cfg);
  for (const [ch, spec] of Object.entries(CHANNELS)) {
    printChannelDetail(ch, spec, cfg, { full });
  }
}

main();
