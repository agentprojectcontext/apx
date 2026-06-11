// Prompt-shaped hint injected into external runtimes when APX delegates work
// to them (Claude Code, Codex, OpenCode, Aider, Cursor Agent, Gemini CLI,
// Qwen Code). Tells the runtime two things only:
//
//   1. "You're being orchestrated by APX as the super-agent (or as agent X
//      via APX delegation)" — equivalent to a one-shot a2a hand-off.
//   2. The session id APX created on disk so the runtime can echo it back
//      via `apx session close <id> --result "..."` if its shell allows it.
//
// We intentionally do NOT re-explain APC: every runtime that can read this
// hint already has the apc-context skill (or equivalent rule) installed in
// its own config, and that rule covers the project context. Repeating it
// here just bloats the prompt. The bridge is APX-specific glue.
//
// (Was `buildApfHint` in host/daemon/apc-runtime-context.js. "APF" was the
// old internal name; renamed for clarity. Lifecycle helpers
// — createRuntimeSession / closeRuntimeSession — live in
// core/stores/runtime-sessions.js.)

const RUNTIME_BRIDGE_HINT = `
# APX runtime delegation

You are being run by APX. The APX super-agent (or the named agent below) handed this turn to you as a one-shot delegation — think of it as an a2a (agent-to-agent) call where you are the callee. APX is the parent process; the project's apc-context already explains the codebase.

- Project: {{name}}
- Delegating agent: {{agent}}
- APX session id: {{session_id}}

When you finish, if you can shell out, leave a short trace for APX:
  apx session close {{session_id}} --result "<one-line summary>"
`.trim();

export function buildRuntimeBridgeHint({ projectName, projectPath, agentSlug, sessionId }) {
  return RUNTIME_BRIDGE_HINT
    .replace(/\{\{name\}\}/g, projectName)
    .replace(/\{\{path\}\}/g, projectPath)
    .replace(/\{\{agent\}\}/g, agentSlug)
    .replace(/\{\{session_id\}\}/g, sessionId);
}

// Back-compat alias — callers can migrate at their own pace.
export const buildApfHint = buildRuntimeBridgeHint;
