// Cursor Agent runtime adapter. Uses print mode for non-interactive runs:
//   cursor-agent --print --output-format text --trust --force "<prompt>"
// Reference: https://docs.cursor.com/en/cli/headless

import { runProcess } from "./_spawn.js";

export default {
  id: "cursor-agent",
  binary: "cursor-agent",
  versionFlag: "--version",

  async run({ system, prompt, cwd, env, timeoutMs }) {
    const fullPrompt = system ? `${system}\n\n---\n\n${prompt}` : prompt;
    const r = await runProcess({
      command: "cursor-agent",
      args: [
        "--print",
        "--output-format", "text",
        "--trust",
        "--force",
        fullPrompt,
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
