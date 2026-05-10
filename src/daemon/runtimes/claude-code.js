// Claude Code runtime adapter. Uses the headless `-p` mode:
//   claude -p "<prompt>"  --append-system-prompt "<system>"  --output-format json
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

  async run({ system, prompt, cwd, env, timeoutMs }) {
    const args = ["-p", prompt, "--output-format", "json"];
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
      externalSessionPath,
      sessionId,
      raw: parsed,
    };
  },
};
