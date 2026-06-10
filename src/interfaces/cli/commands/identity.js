import readline from "node:readline";
import { readIdentity, writeIdentity } from "../../../core/identity/index.js";

function ask(rl, question, defaultVal) {
  return new Promise((resolve) => {
    const hint = defaultVal ? ` (${defaultVal})` : "";
    rl.question(`${question}${hint}: `, (ans) => {
      resolve(ans.trim() || defaultVal || "");
    });
  });
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
    const { readConfig } = await import("../../../core/config.js");
    const cfg = readConfig();
    console.log("");
    console.log(`  Agent name  : ${id.agent_name}`);
    console.log(`  Personality : ${id.personality || "(not set)"}`);
    console.log(`  Owner       : ${id.owner_name}`);
    console.log(`  Context     : ${id.owner_context || "(not set)"}`);
    console.log(`  Language    : ${cfg.user?.language || "en"}  (apx config set user.language <code>)`);
    if (cfg.user?.locale) console.log(`  Locale      : ${cfg.user.locale}`);
    if (cfg.user?.timezone) console.log(`  Timezone    : ${cfg.user.timezone}`);
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

  rl.close();

  const id = writeIdentity({ agent_name, personality, owner_name, owner_context, last_wakeup: null });
  console.log(`\n  Identity saved to ~/.apx/identity.json`);
  console.log(`  ${id.agent_name} is ready. Run ${"apx daemon reload"} after daemon changes.\n`);
}
