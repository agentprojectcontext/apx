// Helpers that wrap external runtimes (Claude Code, Codex, OpenCode, Aider)
// with APC awareness:
//
//   1. Create an APX runtime session BEFORE the runtime starts.
//   2. Inject an "APC Runtime Context" block into the system prompt so the
//      runtime knows the session id, the cwd of the project, and the apx
//      commands it can use to update memory / append session notes.
//   3. After the runtime returns, capture the external transcript path
//      (Claude Code gives one, Codex/OpenCode/Aider don't yet) and write it
//      into the APX session frontmatter.
//   4. Close the session with a synthesised result (truncated stdout).
//
// Used by both POST /projects/:pid/agents/:slug/runtime (CLI) and the
// super-agent's call_runtime tool.

import fs from "node:fs";
import path from "node:path";
import { generateSessionId } from "../core/session-store.js";

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

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

export function buildApfHint({ projectName, projectPath, agentSlug, sessionId }) {
  return APC_RUNTIME_HINT
    .replace(/\{\{name\}\}/g, projectName)
    .replace(/\{\{path\}\}/g, projectPath)
    .replace(/\{\{agent\}\}/g, agentSlug)
    .replace(/\{\{session_id\}\}/g, sessionId);
}

// Create the APX runtime session file on disk. Returns { id, filename, path }.
export function createRuntimeSession({ projectRoot, storageRoot = projectRoot, agentSlug, runtime, taskRef = "", title }) {
  const dir = path.join(storageRoot, "agents", agentSlug, "sessions");
  fs.mkdirSync(dir, { recursive: true });
  const id = generateSessionId(storageRoot, agentSlug);
  const file = path.join(dir, `${id}.md`);
  const started = nowIso();
  const sessionTitle = title || `Runtime: ${runtime}`;
  const body =
    `---\n` +
    `id: ${id}\n` +
    `agent: ${agentSlug}\n` +
    `title: ${sessionTitle}\n` +
    `task_ref: ${taskRef}\n` +
    `status: 🔄 En progreso\n` +
    `started: ${started}\n` +
    `completed: \n` +
    `result: \n` +
    `runtime: ${runtime}\n` +
    `external_session_path: \n` +
    `---\n\n` +
    `# ${sessionTitle}\n\n`;
  fs.writeFileSync(file, body);
  return { id, filename: `${id}.md`, path: file };
}

// Update session frontmatter with the external transcript path captured from
// the runtime adapter. Closes the session with a result string.
export function closeRuntimeSession({ filePath, externalSessionPath, exitCode, result }) {
  let text = fs.readFileSync(filePath, "utf8");
  text = setField(text, "completed", nowIso());
  if (externalSessionPath) {
    text = setField(text, "external_session_path", externalSessionPath);
  }
  if (typeof exitCode === "number") {
    text = setField(text, "result", `${exitCode === 0 ? "✅" : "⚠️"} exit ${exitCode}: ${(result || "").slice(0, 200)}`);
  } else if (result) {
    text = setField(text, "result", result.slice(0, 300));
  }
  text = setField(text, "status", exitCode === 0 ? "✅ Completada" : "⚠️ Cerrada con error");
  fs.writeFileSync(filePath, text);
}

function setField(text, field, value) {
  if (!text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---", 4);
  if (end === -1) return text;
  const fmText = text.slice(4, end);
  const lines = fmText.split("\n");
  let found = false;
  const out = lines.map((line) => {
    if (line.startsWith(`${field}:`)) {
      found = true;
      return `${field}: ${value}`;
    }
    return line;
  });
  if (!found) out.push(`${field}: ${value}`);
  return `---\n${out.join("\n")}\n---${text.slice(end + 4)}`;
}

// Look at the runtime's stdout for a self-reported "APC_RESULT: ..." line
// (the convention printed in the hint above). Returns the captured string or
// null. This is the fallback for runtimes that can't shell out.
export function extractApfResult(stdout) {
  if (!stdout || typeof stdout !== "string") return null;
  const m = stdout.match(/^APC_RESULT:\s*(.+?)\s*$/m);
  return m ? m[1].trim() : null;
}
