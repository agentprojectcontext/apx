#!/usr/bin/env node
// apx — unified CLI for APC (Agent Project Context).
// ESM, Node >= 18.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkForUpdate } from "#core/update-check.js";
import { mascot } from "#core/mascot.js";
import { apxHeader, apxBanner } from "./branding.js";

import { buildHelp, buildTopicHelp, findHelpTopic } from "./help/index.js";
import { resolveRoute } from "./routes/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const VERSION = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "..", "package.json"), "utf8")
).version;

// Flags that never take a value. Without this the parser would greedily
// swallow the following positional (e.g. `apx exec --code "hi"` would set
// flags.code = "hi" and drop the prompt). Boolean flags always resolve to true.
const BOOLEAN_FLAGS = new Set(["code", "verbose", "global", "mcp", "memory"]);

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      // everything after `--` is positional
      args._.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (BOOLEAN_FLAGS.has(key)) {
        args.flags[key] = true;
      } else if (next === undefined || next.startsWith("--")) {
        args.flags[key] = true;
      } else {
        // support repeated flags (e.g. --env A=1 --env B=2)
        if (Object.prototype.hasOwnProperty.call(args.flags, key)) {
          if (Array.isArray(args.flags[key])) args.flags[key].push(next);
          else args.flags[key] = [args.flags[key], next];
        } else {
          args.flags[key] = next;
        }
        i++;
      }
    } else if (a === "-n") {
      args.flags.n = argv[++i];
    } else if (a === "-a") {
      args.flags.agent = argv[++i];
    } else if (a === "-c") {
      args.flags.code = true;
    } else {
      args._.push(a);
    }
  }
  return args;
}

function die(msg, code = 1) {
  // Show panda mascot for user-facing errors
  const isUnknown = msg.startsWith("unknown command") || msg.startsWith("unknown");
  mascot(isUnknown ? "confused" : "sad", `apx: ${msg}`);
  process.exit(code);
}

const argv = process.argv.slice(2);

// ── Global error safety net ──────────────────────────────────────────────────
// Catches any unhandled promise rejection or sync exception that escapes
// the main try/catch — shows the panda instead of a raw Node.js stack trace.
process.on("uncaughtException", (err) => {
  die(err && err.message ? err.message : String(err));
});
process.on("unhandledRejection", (reason) => {
  die(reason instanceof Error ? reason.message : String(reason));
});

const helpRequest = findHelpTopic(argv);
if (argv.length === 0 || helpRequest?.global) {
  process.stdout.write(buildHelp(VERSION));
  process.exit(0);
}
if (helpRequest?.topic) {
  process.stdout.write(buildTopicHelp(helpRequest.topic));
  process.exit(0);
}

if (argv[0] === "--version" || argv[0] === "-v") {
  // Big wordmark to stderr (branding), bare version to stdout so
  // `apx --version` stays parseable in scripts. apxBanner self-suppresses
  // under APX_QUIET / APX_NO_BANNER.
  apxBanner(VERSION, "version");
  console.log(VERSION);
  process.exit(0);
}

// Route a command to its module.
//
// This was a 457-line switch with 141 hand-written `sub === "..."` comparisons
// and 165 eagerly-imported symbols at the top of the file — so `apx status`
// loaded the Electron desktop wiring, the MCP runner and the session scanner
// before it could print anything. Each command now owns its routing in
// routes/<name>.js and is loaded on demand.
async function dispatch(cmd, rest) {
  const load = resolveRoute(cmd);
  if (!load) die(`unknown command: ${cmd}\nRun \`apx --help\` for usage.`);
  const mod = await load();
  await mod.default(rest, { parseArgs, die, dispatch, VERSION });
}

const [topCmd, ...topRest] = argv;

// ── CLI branding ────────────────────────────────────────────────────────────
// Every command prints an "APX CLI · vX · <command>" mark to stderr (so stdout
// pipes stay clean). Two exceptions:
//   - SELF_BRANDED: commands that already render their own logo/mascot/status
//     block — re-stamping them would double up.
//   - BANNERED: branding-heavy moments that get the big ASCII wordmark instead
//     of the compact line.
// Suppress everything with APX_QUIET=1 / APX_NO_BANNER=1 (see branding.js).
const SELF_BRANDED = new Set([
  "status", "setup", "install", "daemon", "update", "upgrade", "help", "restart",
]);
const BANNERED = new Set(["init"]);

function brandFor(cmd, rest) {
  if (SELF_BRANDED.has(cmd)) return;
  // Subtitle = the command path only (cmd + leading subcommand tokens), never
  // free-form args. Stop at the first token that looks like an argument: a flag,
  // something with spaces (a quoted prompt), or anything long. So
  // `skills inspector status` shows fully, but `exec "long prompt…"` shows just
  // `exec`.
  const path = [cmd];
  for (const tok of rest) {
    if (!tok || tok.startsWith("-") || /\s/.test(tok) || tok.length > 24) break;
    path.push(tok);
    if (path.length >= 3) break;
  }
  const subtitle = path.join(" ");
  if (BANNERED.has(cmd)) apxBanner(VERSION, subtitle);
  else apxHeader(VERSION, subtitle);
}

(async () => {
  try {
    brandFor(topCmd, topRest);
    await dispatch(topCmd, topRest);
    checkForUpdate(VERSION);
  } catch (err) {
    die(err && err.message ? err.message : String(err));
  }
})();
