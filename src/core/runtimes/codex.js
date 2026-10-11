// OpenAI Codex CLI runtime adapter.
//   codex exec --sandbox workspace-write --skip-git-repo-check --json "<prompt>"
//   codex exec resume <thread-id> --json "<prompt>"          continue that thread
//   [-m <model>] [-c model_reasoning_effort="<effort>"]       only when APX was asked for one
//   [--add-dir <dir>]... / [-c sandbox_workspace_write.writable_roots=[…]]  linked worktree only
// System prompt is prepended to the prompt body since Codex doesn't have a
// dedicated --system flag in `exec` mode.
// Reference: https://github.com/openai/codex

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { runProcess } from "./_spawn.js";

// workspace-write keeps every .git read-only, and a linked worktree's git
// metadata lives outside cwd anyway. Grant only what fetch/add/commit write:
// its own git dir plus the shared objects/refs/logs — never the common dir's
// root (config, hooks, packed-refs), other worktrees, or the main checkout.
// See rules/HISTORY.md#codex-linked-worktree
const SHARED_GIT_WRITES = ["objects", "refs", "logs"];

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function realDir(p) {
  try { return fs.realpathSync(p); } catch { return p; }
}

/**
 * The directories a codex run in `cwd` needs writable for git to work, when
 * `cwd` is inside a linked worktree (git dir ≠ common dir). [] otherwise —
 * a normal checkout, a non-repo, or git missing.
 */
export function linkedWorktreeWritableDirs(cwd, env = {}) {
  if (!cwd) return Promise.resolve([]);
  // An inherited GIT_DIR (git exports it to hooks) would make git ignore cwd.
  const gitEnv = {};
  for (const [k, v] of Object.entries({ ...process.env, ...env })) {
    if (!k.startsWith("GIT_")) gitEnv[k] = v;
  }
  return new Promise((resolve) => {
    execFile(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"],
      { cwd, env: gitEnv, timeout: 10_000 },
      (err, stdout) => {
        if (err) return resolve([]);
        const [gitDir, commonDir] = String(stdout).trim().split("\n").map((l) => realDir(l.trim()));
        if (!gitDir || !commonDir || gitDir === commonDir) return resolve([]);
        const dirs = [gitDir, ...SHARED_GIT_WRITES.map((d) => path.join(commonDir, d))];
        resolve(dirs.filter(isDir));
      },
    );
  });
}

// TOML array of basic strings; JSON string escapes are valid TOML ones.
function tomlStringArray(items) {
  return `[${items.map((s) => JSON.stringify(s)).join(",")}]`;
}

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
    // A read-only run never gets them. `exec resume` has no --add-dir and does
    // not keep the first turn's, so a resumed turn names them through -c.
    const gitDirs = mode === "chat" ? [] : await linkedWorktreeWritableDirs(cwd, env);
    const args = resumeSessionId
      ? [
          "exec", "resume", "--skip-git-repo-check", "--json", ...pin,
          ...(gitDirs.length ? ["-c", `sandbox_workspace_write.writable_roots=${tomlStringArray(gitDirs)}`] : []),
          resumeSessionId, fullPrompt,
        ]
      : [
          "exec", "--sandbox", sandbox, ...gitDirs.flatMap((d) => ["--add-dir", d]),
          "--skip-git-repo-check", "--json", ...pin, fullPrompt,
        ];

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
