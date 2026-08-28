// OpenAI Codex CLI runtime adapter.
//   codex exec --sandbox workspace-write --skip-git-repo-check --json "<prompt>"
//   codex exec resume <thread-id> --json "<prompt>"          continue that thread
// System prompt is prepended to the prompt body since Codex doesn't have a
// dedicated --system flag in `exec` mode.
// Reference: https://github.com/openai/codex

import { runProcess } from "./_spawn.js";

// `--json` turns stdout into JSONL events. We ask for it because it is the only
// place codex names the thread it opened, and that id is what lets the NEXT
// turn resume this same conversation instead of starting a stranger. The prose
// we would otherwise have printed is in the agent_message items.
function parseCodexEvents(stdout) {
  let threadId = null;
  const messages = [];
  for (const raw of String(stdout || "").split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("{")) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type === "thread.started" && event.thread_id) threadId = event.thread_id;
    if (
      event.type === "item.completed" &&
      event.item?.type === "agent_message" &&
      event.item.text
    ) {
      messages.push(String(event.item.text));
    }
  }
  return { threadId, text: messages.join("\n\n").trim() };
}

export default {
  id: "codex",
  binary: "codex",
  versionFlag: "--version",
  sessions: "capture",

  async run({ system, prompt, cwd, env, timeoutMs, resumeSessionId = null, mode = "code" }) {
    const fullPrompt = system ? `${system}\n\n---\n\n${prompt}` : prompt;
    // `exec resume` takes no --sandbox: it inherits the sandbox the thread was
    // opened with, and passing the flag is an error rather than a no-op. Which
    // means the FIRST turn decides what the thread may touch for its whole life.
    const sandbox = mode === "chat" ? "read-only" : "workspace-write";
    const args = resumeSessionId
      ? ["exec", "resume", resumeSessionId, "--skip-git-repo-check", "--json", fullPrompt]
      : ["exec", "--sandbox", sandbox, "--skip-git-repo-check", "--json", fullPrompt];

    const r = await runProcess({ command: "codex", args, cwd, env, timeoutMs });
    const { threadId, text } = parseCodexEvents(r.stdout);

    return {
      exitCode: r.exitCode,
      // A build that emitted no parsable event still said something on stdout;
      // falling back to the raw text keeps this adapter working as before.
      output: text || String(r.stdout || "").trim(),
      stderr: r.stderr,
      killed: r.killed,
      sessionId: threadId || resumeSessionId || null,
      externalSessionPath: null,
    };
  },
};
