// OpenAI Codex CLI runtime adapter.
//   codex exec --sandbox workspace-write --skip-git-repo-check --json "<prompt>"
//   codex exec resume <thread-id> --json "<prompt>"          continue that thread
//   [-m <model>] [-c model_reasoning_effort="<effort>"]       only when APX was asked for one
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
  // Model and effort APX can pass (core/runtimes/model.js). Without them codex
  // uses ~/.codex/config.toml — the documented `inherit` contract.
  modelOptions: { model: true, effort: true },
  nativeProviders: ["chatgpt-codex", "openai"],

  async run({ system, prompt, cwd, env, timeoutMs, resumeSessionId = null, mode = "code", model = null, effort = null }) {
    const fullPrompt = system ? `${system}\n\n---\n\n${prompt}` : prompt;
    // `exec resume` takes no --sandbox: it inherits the sandbox the thread was
    // opened with, and passing the flag is an error rather than a no-op. Which
    // means the FIRST turn decides what the thread may touch for its whole life.
    const sandbox = mode === "chat" ? "read-only" : "workspace-write";
    // Both `exec` and `exec resume` take -m / -c, so a resumed thread can be
    // pinned too — the sandbox is the only thing the first turn fixes.
    const pin = [
      ...(model ? ["-m", model] : []),
      ...(effort ? ["-c", `model_reasoning_effort="${effort}"`] : []),
    ];
    const args = resumeSessionId
      ? ["exec", "resume", "--skip-git-repo-check", "--json", ...pin, resumeSessionId, fullPrompt]
      : ["exec", "--sandbox", sandbox, "--skip-git-repo-check", "--json", ...pin, fullPrompt];

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
