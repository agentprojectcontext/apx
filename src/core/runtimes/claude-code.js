// Claude Code runtime adapter. Uses the headless `-p` mode:
//   claude -p "<prompt>"  --append-system-prompt "<system>"  --output-format json
//   claude -p "<prompt>"  --resume <session-id>              continue that session
// Returns one JSON line with the result and session_id.
// Reference: https://docs.claude.com/en/docs/claude-code/headless

import fs from "node:fs";
import path from "node:path";
import { runProcess } from "./_spawn.js";

export function encodeClaudeProjectPath(cwd) {
  return String(cwd || process.cwd()).replace(/[^A-Za-z0-9]/g, "-");
}

export function resolveClaudeSessionPath({ cwd, sessionId, home = process.env.HOME || process.env.USERPROFILE || "" }) {
  if (!sessionId || !home) return null;
  const projectsDir = path.join(home, ".claude", "projects");
  const encodedCwd = encodeClaudeProjectPath(cwd);
  const expected = path.join(projectsDir, encodedCwd, `${sessionId}.jsonl`);
  if (fs.existsSync(expected)) return expected;

  try {
    for (const dir of fs.readdirSync(projectsDir)) {
      const candidate = path.join(projectsDir, dir, `${sessionId}.jsonl`);
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {}

  return expected;
}

export default {
  id: "claude-code",
  binary: "claude",
  versionFlag: "--version",

  sessions: "capture",

  async run({ system, prompt, cwd, env, timeoutMs, resumeSessionId = null, mode = "code" }) {
    const args = ["-p", prompt, "--output-format", "json"];
    // `plan` is Claude Code's own read-only mode: it answers normally but will
    // not edit. That is what a plain a2a message should get — a peer you talked
    // to should not be able to rewrite your checkout because it was asked to.
    if (mode === "chat") args.push("--permission-mode", "plan");
    if (resumeSessionId) args.push("--resume", resumeSessionId);
    if (system) {
      args.push("--append-system-prompt", system);
    }
    const r = await runProcess({
      command: "claude",
      args,
      cwd,
      env,
      timeoutMs,
    });

    let output = r.stdout.trim();
    let sessionId = null;
    let externalSessionPath = null;
    let parsed = null;

    if (output) {
      try {
        // headless --output-format json emits a single-line JSON result
        parsed = JSON.parse(output);
        if (parsed.result) output = parsed.result;
        sessionId = parsed.session_id || null;
      } catch {
        // not JSON — keep raw stdout
      }
    }

    if (sessionId) {
      externalSessionPath = resolveClaudeSessionPath({ cwd, sessionId });
    }

    return {
      exitCode: r.exitCode,
      output,
      stderr: r.stderr,
      killed: r.killed,
      externalSessionPath,
      sessionId: sessionId || resumeSessionId || null,
      raw: parsed,
    };
  },
};
