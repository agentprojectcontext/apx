// Shared git spawn helper. Resolves the working directory from the same
// project/cwd contract every other shell-aware tool uses (resolveProject),
// then runs `git <args...>` with no shell so paths with spaces are safe.
import { spawn } from "node:child_process";
import { resolveProject } from "../helpers.js";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_CHARS = 60_000; // ~15K tokens — generous for diffs, cuts runaways

export function runGit(args, { cwd, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const truncated = stdout.length > MAX_OUTPUT_CHARS;
      if (truncated) stdout = stdout.slice(0, MAX_OUTPUT_CHARS) + "\n…(output truncated)";
      resolve({
        ok: code === 0,
        code,
        stdout,
        stderr: stderr.trim() || null,
        timedOut,
        truncated,
      });
    });
  });
}

/** Resolve the working directory for a git tool from the standard tool args. */
export function resolveGitCwd(ctx, { project, cwd }) {
  // 1) If `cwd` was passed, use it directly (advanced override).
  if (cwd) return cwd;
  // 2) Otherwise resolve `project` (id, name, or path) → project root.
  const proj = resolveProject(ctx.projects, project);
  if (!proj) throw new Error("git: no project resolved (pass project or cwd)");
  return proj.path;
}
