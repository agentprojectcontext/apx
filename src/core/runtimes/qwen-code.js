// Qwen Code runtime adapter. Uses non-interactive mode:
//   qwen --output-format text --approval-mode yolo "<prompt>"
// Reference: https://qwenlm.github.io/qwen-code-docs/en/cli/index

import { runProcess } from "./_spawn.js";

export default {
  id: "qwen-code",
  binary: "qwen",
  versionFlag: "--version",

  async run({ system, prompt, cwd, env, timeoutMs }) {
    const args = [
      "--output-format", "text",
      "--approval-mode", "yolo",
    ];
    if (system) {
      args.push("--append-system-prompt", system);
    }
    args.push(prompt);

    const r = await runProcess({
      command: "qwen",
      args,
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
