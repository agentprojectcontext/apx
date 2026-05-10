// Runtime adapters: spawn external agent CLIs (Claude Code, Codex, OpenCode,
// Aider, Cursor Agent, Gemini CLI, Qwen Code, ...) with the agent's system prompt + the prompt we want to run, and
// capture their output. Unlike engines/ — which talk directly to model APIs —
// runtimes/ delegate the whole conversation to the external tool. APX only
// records the invocation, the prompt, the captured output, and where the tool
// stored its own session (if it tells us).
//
// Each runtime exports:
//   {
//     id,
//     binary,                         executable name to look for in PATH
//     versionFlag,                    flag to print the version
//     async run({ system, prompt, cwd, env, timeoutMs })
//          → { exitCode, output, externalSessionPath?, raw? }
//   }

import claudeCode from "./claude-code.js";
import codex from "./codex.js";
import opencode from "./opencode.js";
import aider from "./aider.js";
import cursorAgent from "./cursor-agent.js";
import geminiCli from "./gemini-cli.js";
import qwenCode from "./qwen-code.js";

const REGISTRY = {
  "claude-code": claudeCode,
  codex,
  opencode,
  aider,
  "cursor-agent": cursorAgent,
  "gemini-cli": geminiCli,
  "qwen-code": qwenCode,
};

export const RUNTIME_IDS = Object.keys(REGISTRY);

export function getRuntime(id) {
  const r = REGISTRY[id];
  if (!r) {
    throw new Error(
      `unknown runtime "${id}". Known: ${RUNTIME_IDS.join(", ")}`
    );
  }
  return r;
}
