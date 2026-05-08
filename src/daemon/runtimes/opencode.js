// OpenCode runtime adapter. Uses headless run:
//   opencode run "<prompt>"
// Reference: https://opencode.ai/docs/

import { runProcess } from "./_spawn.js";

export default {
  id: "opencode",
  binary: "opencode",
  versionFlag: "--version",

  async run({ system, prompt, cwd, env, timeoutMs }) {
    const fullPrompt = system ? `${system}\n\n---\n\n${prompt}` : prompt;
    const r = await runProcess({
      command: "opencode",
      args: ["run", fullPrompt],
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
