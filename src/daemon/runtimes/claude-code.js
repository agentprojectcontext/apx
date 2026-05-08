// Claude Code runtime adapter. Uses the headless `-p` mode:
//   claude -p "<prompt>"  --append-system-prompt "<system>"  --output-format json
// Returns one JSON line with the result and session_id.
// Reference: https://docs.claude.com/en/docs/claude-code/headless

import { runProcess } from "./_spawn.js";

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
      // Claude Code's session directory naming: replace BOTH "/" and "_" with
      // "-" (verified empirically against ~/.claude/projects/). The trailing
      // file is `<sessionId>.jsonl`.
      const home = process.env.HOME || process.env.USERPROFILE || "";
      const encodedCwd = (cwd || process.cwd()).replace(/[/_]/g, "-");
      externalSessionPath = `${home}/.claude/projects/${encodedCwd}/${sessionId}.jsonl`;
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
