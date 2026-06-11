// Prompt-shaped helpers that bridge APX into external runtimes (Claude Code,
// Codex, OpenCode, Aider, Cursor Agent, Gemini CLI, Qwen Code). The returned
// text is injected into the runtime's system prompt so it knows it's running
// inside an APC project with an APX session id, and knows the `apx …`
// commands it can shell out to.
//
// (Was `buildApfHint` in host/daemon/apc-runtime-context.js. "APF" was the
// old name for what's now APC — renamed here and the lifecycle helpers moved
// to core/stores/runtime-sessions.js.)

const APC_RUNTIME_HINT = `
# APC Runtime Context

You are running inside an APC (Agent Project Context) project. APC gives you portable project context. APX gives you local runtime session state.

- **Project**: {{name}}  ({{path}})
- **Agent**: {{agent}}
- **APC session id**: {{session_id}}
  (stored in APX local runtime storage, outside .apc/)

## Commands you can use during this run

- \`apx memory {{agent}} --append "<note>"\`        save a long-term fact for this agent
- \`apx session update {{session_id}} --status "..."\`   update the session status
- \`apx session update {{session_id}} --task-ref TASK-...\`  link to an external task

## When you finish

Close the session with a one-line result so a future operator (or apx session resume) can summarize:

  apx session close {{session_id}} --result "<one-line summary of what you did>"

If you cannot run apx (sandboxed shell), just print the result on the last line of your output prefixed with "APC_RESULT:" and APX will capture it automatically.
`.trim();

export function buildRuntimeBridgeHint({ projectName, projectPath, agentSlug, sessionId }) {
  return APC_RUNTIME_HINT
    .replace(/\{\{name\}\}/g, projectName)
    .replace(/\{\{path\}\}/g, projectPath)
    .replace(/\{\{agent\}\}/g, agentSlug)
    .replace(/\{\{session_id\}\}/g, sessionId);
}

// Back-compat alias — callers can migrate at their own pace.
export const buildApfHint = buildRuntimeBridgeHint;
