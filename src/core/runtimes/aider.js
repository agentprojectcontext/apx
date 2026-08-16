// Aider runtime adapter. Uses --message for non-interactive mode.
//   aider --message "<prompt>" --no-auto-commits --yes
// Reference: https://aider.chat/docs/scripting.html

import { runProcess } from "./_spawn.js";

export default {
  id: "aider",
  binary: "aider",
  versionFlag: "--version",

  async run({ system, prompt, cwd, env, timeoutMs }) {
    const fullPrompt = system ? `${system}\n\n---\n\n${prompt}` : prompt;
    const r = await runProcess({
      command: "aider",
      args: [
        "--message", fullPrompt,
        "--yes-always",
        "--no-auto-commits",
      ],
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
