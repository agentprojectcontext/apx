// The first time a tool touches a folder that carries its own AGENTS.md, that
// file rides along on the tool result. Rules that only apply to one subfolder
// (how posts are scheduled, how a service is deployed) used to reach the model
// only if it thought to read them — and on a busy turn it did not. Attaching
// them to the result keeps the system prompt stable (cache-friendly) and lands
// the rules exactly when the work reaches that folder. Once per turn per file.
import { createHash } from "node:crypto";
import path from "node:path";
import { resolveProject } from "#core/apc/projects-helpers.js";
import { directoryRulesFor } from "#core/agent/context/turn-context.js";

// tool → how to find the folder it touched. `file` means the arg names a file.
const TOUCHES = {
  read_file: { arg: "path", file: true },
  edit_file: { arg: "path", file: true },
  write_file: { arg: "path", file: true },
  list_files: { arg: "path" },
  search_files: { arg: "path" },
  run_shell: { arg: "cwd" },
  glob: { arg: "cwd", absolute: true },
  grep: { arg: "path", absolute: true },
};

function containingProject(projects, abs) {
  let best = null;
  for (const entry of projects?.list?.() || []) {
    const root = entry?.path && path.resolve(entry.path);
    if (!root || String(entry.id) === "0") continue;
    if ((abs === root || abs.startsWith(root + path.sep)) && (!best || root.length > best.length)) best = root;
  }
  return best;
}

/** The (projectRoot, folder) a call touched, or null. Never throws. */
export function touchedFolder(name, args, ctx) {
  const spec = TOUCHES[name];
  if (!spec || !args || typeof args !== "object") return null;
  const raw = args[spec.arg];
  try {
    let root;
    let target;
    if (typeof raw === "string" && path.isAbsolute(raw)) {
      target = path.resolve(raw);
      root = containingProject(ctx?.projects, target);
    } else {
      if (spec.absolute) return null;
      const p = resolveProject(ctx?.projects, args.project);
      root = p?.path && path.resolve(p.path);
      target = root ? path.resolve(root, typeof raw === "string" && raw ? raw : ".") : null;
    }
    if (!root || !target) return null;
    const folder = spec.file ? path.dirname(target) : target;
    return { root, folder };
  } catch {
    return null;
  }
}

/**
 * `result` plus `folder_rules` when the call reached a folder whose rules the
 * model has not seen this turn. `seen` persists across the turn's passes.
 */
export function attachDirectoryRules({ name, args, result, ctx, seen }) {
  if (!seen || !result || typeof result !== "object" || Array.isArray(result)) return result;
  const where = touchedFolder(name, args, ctx);
  if (!where) return result;
  const rules = directoryRulesFor(where.root, where.folder, seen);
  if (!rules.length) return result;
  // First key, so a result clipped for size still carries the rules.
  return {
    folder_rules: {
      note: "This folder has its own rules. Read and follow them before acting here — they override general habits.",
      files: rules,
    },
    ...result,
  };
}

/**
 * `result` as the trace records it: each attached rules file reduced to one
 * flat line (path, bytes, hash). Left nested, the trace summarizer collapses
 * `files[]` to "…(nested)" and the record no longer says WHICH rules arrived.
 */
export function folderRulesForTrace(result) {
  const files = result?.folder_rules?.files;
  if (!Array.isArray(files)) return result;
  return {
    ...result,
    folder_rules: files.map((f) => {
      const text = String(f?.content ?? "");
      const sha = createHash("sha256").update(text).digest("hex").slice(0, 12);
      return `${f?.path} · ${Buffer.byteLength(text)} bytes · sha256:${sha}`;
    }),
  };
}
