// Runtime adapters: spawn external agent CLIs (Claude Code, Codex, OpenCode,
// Aider, Cursor Agent, Gemini CLI, Qwen Code, ...) with the agent's system
// prompt + the prompt we want to run, and
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
//     sessions,                       "capture" when it can continue its own
//                                     conversation; absent when every run
//                                     starts cold
//     async run({ system, prompt, cwd, env, timeoutMs,
//                 sessionKey, resumeSessionId })
//          → { exitCode, output, sessionId?, externalSessionPath?, raw? }
//   }
//
// The session arguments are what turn a runtime from a one-shot into a real
// a2a peer: `resumeSessionId` continues the conversation the peer already has,
// and `sessionId` comes back so the caller can store it and resume again next
// turn. `sessionKey` is a stable name for the exchange, for CLIs that can only
// find their own session again by title (opencode); the ones that hand their id
// straight back (claude-code, codex) ignore it.
//
// A runtime WITHOUT sessions is not shut out of a2a — the caller flattens the
// thread history into the prompt instead. Sessions only make that unnecessary,
// which is the point: a resumed peer does not re-read what it already knows.

import claudeCode from "./claude-code.js";
import codex from "./codex.js";
import opencode from "./opencode.js";
import aider from "./aider.js";
import cursorAgent from "./cursor-agent.js";
import geminiCli from "./gemini-cli.js";
import qwenCode from "./qwen-code.js";
import antigravity from "./antigravity.js";

const REGISTRY = {
  "claude-code": claudeCode,
  codex,
  opencode,
  aider,
  "cursor-agent": cursorAgent,
  "gemini-cli": geminiCli,
  "qwen-code": qwenCode,
  antigravity,
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
