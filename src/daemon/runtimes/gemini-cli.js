// Gemini CLI runtime adapter. Uses headless prompt mode:
//   gemini --prompt "<prompt>" --output-format text --approval-mode yolo
// Reference: https://google-gemini.github.io/gemini-cli/docs/cli/headless.html

import { runProcess } from "./_spawn.js";

export default {
  id: "gemini-cli",
  binary: "gemini",
  versionFlag: "--version",

  async run({ system, prompt, cwd, env, timeoutMs }) {
    const fullPrompt = system ? `${system}\n\n---\n\n${prompt}` : prompt;
    const r = await runProcess({
      command: "gemini",
      args: [
        "--prompt", fullPrompt,
        "--output-format", "text",
        "--approval-mode", "yolo",
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
