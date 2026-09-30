// Writing a file that holds credentials always asks the owner — whatever the
// permission mode says, `total` included.
//
// `total` means "don't ask me about ordinary work", and it is what the owner
// runs. But a model that rewrites ~/.apx/config.json or an mcps.json with a
// shell one-liner can drop an API key, a bot token or an MCP's Authorization
// header in a way no later turn can undo, and nothing else in the loop looks at
// WHAT a write touches. The native tools that manage those files (add_mcp,
// `apx config set`) go through core writers that refuse to clear credentials;
// this guard is for everything that goes around them.
//
// Reads are not gated here: this is about losing or corrupting a secret, and
// the redaction layer already keeps secret values out of what the owner reads.
import os from "node:os";
import path from "node:path";
import { resolveProject } from "#core/apc/projects-helpers.js";
import { safePathJoin } from "#core/agent/tools/helpers.js";
import { parsePatch } from "#core/agent/tools/patch/apply-patch.js";
import { apxHome } from "#core/config/paths.js";

// A file is a secret store by its name, wherever it lives…
const SECRET_BASENAME = /^(\.env(\..+)?|auth\.json|credentials(\..+)?\.json|\.credentials\.json|id_(rsa|ed25519|ecdsa)|.+\.pem|.+\.key|\.netrc|\.npmrc|\.pypirc)$/i;
// …unless it is the template that documents one.
const TEMPLATE = /\.(example|sample|template|dist)$/i;
// …or by being one of APX's own stores of tokens, relative to APX_HOME.
const APX_SECRET_FILES = /^(config\.json|mcps\.json|daemon\.token|telegram-state\.json|projects\/[^/]+\/(mcps|config)\.json)$/;

export function isSecretPath(file) {
  if (!file) return false;
  const abs = path.resolve(String(file).replace(/^~(?=\/|$)/, os.homedir()));
  const base = path.basename(abs);
  if (SECRET_BASENAME.test(base) && !TEMPLATE.test(base)) return true;
  const rel = path.relative(apxHome(), abs);
  return !rel.startsWith("..") && !path.isAbsolute(rel) && APX_SECRET_FILES.test(rel.split(path.sep).join("/"));
}

// Shell text that names a secret store AND writes something. Names alone do
// not count: `cat .env.example` or `grep token config.json` changes nothing.
const SECRET_IN_SHELL = /(\.apx\/(config\.json|mcps\.json|daemon\.token|projects\/[^\s'"]+\/(mcps|config)\.json)|(^|[\s'"/=])\.env(\.(?!example|sample|template)[\w-]+)?(?=$|[\s'";|&>)])|auth\.json|credentials[\w.-]*\.json|id_(rsa|ed25519|ecdsa)|\.pem\b|\.netrc|\.npmrc)/i;
const SHELL_WRITES = /(>>?|\btee\b|\bsed\s+(-[a-z]*i|--in-place)|\bperl\s+-[a-z]*i|\bmv\b|\bcp\b|\brm\b|\btruncate\b|\bdd\b|\bchmod\b|\bln\b|writeFileSync|write_text|open\([^)]*['"]w|\bjq\b[^|]*>\s*\S)/i;

function shellTouchesSecret(command) {
  const cmd = String(command || "");
  if (!SECRET_IN_SHELL.test(cmd) || !SHELL_WRITES.test(cmd)) return false;
  // `apx config set` / `apx mcp …` go through the guarded core writers.
  if (/^\s*apx\s+(config|mcp)\b/.test(cmd) && !/[;&|]/.test(cmd)) return false;
  return true;
}

function projectPath(ctx, project, rel) {
  try {
    const p = resolveProject(ctx?.projects, project);
    return safePathJoin(p.path, rel);
  } catch {
    return null;
  }
}

/**
 * The secret store a call would write, as a short description — or null.
 * Never throws: a guard that crashes a turn is a guard people turn off.
 */
export function secretWriteTarget(name, args, ctx) {
  try {
    if (!args || typeof args !== "object") return null;
    if (name === "write_file" || name === "edit_file") {
      const abs = projectPath(ctx, args.project, args.path);
      return abs && isSecretPath(abs) ? abs : null;
    }
    if (name === "apply_patch") {
      for (const op of parsePatch(args.patch)) {
        for (const rel of [op.path, op.moveTo].filter(Boolean)) {
          const abs = projectPath(ctx, args.project, rel);
          if (abs && isSecretPath(abs)) return abs;
        }
      }
      return null;
    }
    if (name === "run_shell") {
      return shellTouchesSecret(args.command) ? `shell: ${String(args.command).slice(0, 160)}` : null;
    }
    return null;
  } catch {
    return null;
  }
}
