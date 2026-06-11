// On-disk session state for external runtimes (Claude Code, Codex, OpenCode,
// Aider, Cursor Agent, Gemini CLI, Qwen Code). One markdown file per session
// under <storageRoot>/agents/<slug>/sessions/<id>.md with YAML frontmatter
// (id, agent, title, task_ref, status, started, completed, result, runtime,
// external_session_path).
//
// The "bridge" prompt-text builder that explains this layout to the external
// runtime lives in core/agent/runtime-bridge.js. Both used to live together
// in host/daemon/apc-runtime-context.js; they were split because they have
// different homes (text → core/agent, state → core/stores).
import fs from "node:fs";
import path from "node:path";
import { generateSessionId } from "./sessions.js";
import { nowIso } from "#core/util/time.js";

/** Create the APX runtime session file. Returns { id, filename, path }. */
export function createRuntimeSession({
  projectRoot,
  storageRoot = projectRoot,
  agentSlug,
  runtime,
  taskRef = "",
  title,
}) {
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
    `status: 🔄 In progress\n` +
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

/** Update session frontmatter with the external transcript path + final state. */
export function closeRuntimeSession({ filePath, externalSessionPath, exitCode, result }) {
  let text = fs.readFileSync(filePath, "utf8");
  text = setField(text, "completed", nowIso());
  if (externalSessionPath) {
    text = setField(text, "external_session_path", externalSessionPath);
  }
  if (typeof exitCode === "number") {
    text = setField(
      text,
      "result",
      `${exitCode === 0 ? "✅" : "⚠️"} exit ${exitCode}: ${(result || "").slice(0, 200)}`
    );
  } else if (result) {
    text = setField(text, "result", result.slice(0, 300));
  }
  text = setField(text, "status", exitCode === 0 ? "✅ Completed" : "⚠️ Closed with error");
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

/**
 * Extract a self-reported "APC_RESULT: ..." line from the runtime's stdout
 * (the convention printed in the bridge hint). Returns the captured string
 * or null. Fallback for runtimes that can't shell out to `apx session close`.
 */
export function extractRuntimeResult(stdout) {
  if (!stdout || typeof stdout !== "string") return null;
  const m = stdout.match(/^APC_RESULT:\s*(.+?)\s*$/m);
  return m ? m[1].trim() : null;
}

// Back-compat alias.
export const extractApfResult = extractRuntimeResult;
