import readline from "node:readline";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readIdentity, writeIdentity } from "../../core/identity.js";

function ask(rl, question, defaultVal) {
  return new Promise((resolve) => {
    const hint = defaultVal ? ` (${defaultVal})` : "";
    rl.question(`${question}${hint}: `, (ans) => {
      resolve(ans.trim() || defaultVal || "");
    });
  });
}

function askYN(rl, question, defaultYes = false) {
  const hint = defaultYes ? "Y/n" : "y/N";
  return new Promise((resolve) => {
    rl.question(`${question} [${hint}]: `, (ans) => {
      const a = ans.trim().toLowerCase();
      if (!a) return resolve(defaultYes);
      resolve(a === "y" || a === "yes");
    });
  });
}

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");

function setupClaudePermissions() {
  try {
    let existing = {};
    if (fs.existsSync(CLAUDE_SETTINGS_PATH)) {
      existing = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, "utf8"));
    }
    const updated = {
      ...existing,
      permissions: {
        ...(existing.permissions || {}),
        allow: [
          ...(existing.permissions?.allow || []),
          "Bash(*)",
          "Read(*)",
          "Write(*)",
          "Edit(*)",
        ].filter((v, i, arr) => arr.indexOf(v) === i),
      },
    };
    fs.mkdirSync(path.dirname(CLAUDE_SETTINGS_PATH), { recursive: true });
    fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(updated, null, 2) + "\n");
    return true;
  } catch (e) {
    return e.message;
  }
}

// apx identity           — show
// apx identity set       — interactive or --name/--owner/--context/--language flags
// apx identity wizard    — full onboarding (called on first run)
export async function cmdIdentity(args) {
  const sub = args._[0];

  if (!sub || sub === "show") {
    const id = readIdentity();
    if (!id) {
      console.log("No identity configured. Run: apx identity wizard");
      return;
    }
    const { readConfig } = await import("../../core/config.js");
    const cfg = readConfig();
    console.log("");
    console.log(`  Agent name  : ${id.agent_name}`);
    console.log(`  Personality : ${id.personality || "(not set)"}`);
    console.log(`  Owner       : ${id.owner_name}`);
    console.log(`  Context     : ${id.owner_context || "(not set)"}`);
    console.log(`  Language    : ${cfg.user?.language || "en"}  (set via: apx config set user.language <code>)`);
    console.log(`  Last wakeup : ${id.last_wakeup || "(never)"}`);
    console.log(`  File        : ~/.apx/identity.json`);
    console.log("");
    return;
  }

  if (sub === "set") {
    const fields = {};
    if (args.flags.name && args.flags.name !== true) fields.agent_name = args.flags.name;
    if (args.flags.owner && args.flags.owner !== true) fields.owner_name = args.flags.owner;
    if (args.flags.context && args.flags.context !== true) fields.owner_context = args.flags.context;
    if (args.flags.personality && args.flags.personality !== true) fields.personality = args.flags.personality;
    if (args.flags.language && args.flags.language !== true) fields.language = args.flags.language;

    if (Object.keys(fields).length === 0) {
      console.log("Usage: apx identity set --name <name> --owner <name> --context <text> --personality <text> --language <lang>");
      return;
    }

    const id = writeIdentity(fields);
    console.log("Identity updated:");
    for (const [k, v] of Object.entries(fields)) console.log(`  ${k}: ${v}`);
    if (id.last_wakeup) {
      writeIdentity({ last_wakeup: null });
      console.log("  (wakeup cooldown reset — next daemon start will send a new message)");
    }
    return;
  }

  if (sub === "wizard") {
    await runWizard();
    return;
  }

  throw new Error(`unknown identity subcommand: ${sub}`);
}

export async function runWizard() {
  const existing = readIdentity() || {};
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log("\n  APX Identity Setup\n");
  console.log("  Defines who the agent is, who it works for, and what extra context");
  console.log("  it carries in every conversation (injected into the system prompt).");
  console.log("  Language is configured separately via: apx config set user.language <code>\n");

  const agent_name    = await ask(rl, "  Agent name", existing.agent_name || "APX");
  const personality   = await ask(rl, "  Personality (comma-separated traits)", existing.personality || "direct, curious, helpful");
  const owner_name    = await ask(rl, "  Your name", existing.owner_name || "");
  const owner_context = await ask(rl, "  Context for the agent (what you build / work on — added to every system prompt)", existing.owner_context || "");

  console.log("\n  Claude Code permissions");
  console.log("  APX can configure Claude Code to allow terminal commands without prompts.");
  console.log("  This adds Bash(*), Read(*), Write(*), Edit(*) to ~/.claude/settings.json\n");

  const setupPerms = await askYN(rl, "  Set up Claude Code terminal permissions now?", false);

  rl.close();

  const id = writeIdentity({ agent_name, personality, owner_name, owner_context, last_wakeup: null });
  console.log(`\n  Identity saved to ~/.apx/identity.json`);

  if (setupPerms) {
    const result = setupClaudePermissions();
    if (result === true) {
      console.log(`  Claude Code permissions updated at ~/.claude/settings.json`);
    } else {
      console.log(`  Could not update Claude Code settings: ${result}`);
    }
  }

  console.log(`  ${id.agent_name} is ready. Restart the daemon to send a wake-up message.\n`);
}
