// OpenAI Codex CLI runtime adapter.
//   codex exec "<prompt>"
// System prompt is prepended to the prompt body since Codex doesn't have a
// dedicated --system flag in `exec` mode.
// Reference: https://github.com/openai/codex

import { runProcess } from "./_spawn.js";

export default {
  id: "codex",
  binary: "codex",
  versionFlag: "--version",

  async run({ system, prompt, cwd, env, timeoutMs }) {
    const fullPrompt = system ? `${system}\n\n---\n\n${prompt}` : prompt;
    const r = await runProcess({
      command: "codex",
      args: ["exec", fullPrompt],
      cwd,
      env,
      timeoutMs,
    });
    return {
      exitCode: r.exitCode,
      output: r.stdout.trim(),
      stderr: r.stderr,
      externalSessionPath: null,
    };
  },
};
