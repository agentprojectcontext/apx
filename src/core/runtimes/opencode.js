// OpenCode runtime adapter. Uses headless run:
//   opencode run "<prompt>"
//   opencode run --session <id> "<prompt>"   continue an earlier exchange
// Reference: https://opencode.ai/docs/

import fs from "node:fs";
import path from "node:path";
import { runProcess } from "./_spawn.js";

// opencode prints an "agent · model" banner and ANSI colour even when its stdout
// is a pipe. Neither is part of the answer, and an a2a reply is logged verbatim
// — so a banner would be filed as the peer's first sentence.
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
const BANNER = /^>\s+\S+\s+\S\s+\S+\s*$/;

function cleanOutput(stdout) {
  const lines = String(stdout || "").replace(ANSI, "").split("\n");
  while (lines.length && !lines[0].trim()) lines.shift();
  // Exactly one banner, and only when it leads: a reply that legitimately
  // opens with a quoted line has to survive intact.
  if (lines.length && BANNER.test(lines[0])) lines.shift();
  return lines.join("\n").trim();
}

// opencode mints its own session ids and refuses one it did not create
// ("Session not found"), so APX cannot dictate the id the way Claude Code
// allows. What it CAN do is name the session on the way in (--title) and read
// the id back out of `session list`, which speaks JSON. One extra call, only on
// a thread's first turn — after that the id is on the ledger.
async function findSessionByTitle({ title, cwd, env }) {
  const r = await runProcess({
    command: "opencode",
    args: ["session", "list", "--format", "json", "-n", "40"],
    cwd,
    env,
    timeoutMs: 20000,
  });
  if (r.exitCode !== 0) return null;
  let rows;
  try {
    rows = JSON.parse(r.stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(rows)) return null;
  const named = rows.filter((s) => s && s.title === title);
  // Sessions are listed across projects; prefer the one opened here.
  const here = named.filter((s) => !cwd || !s.directory || s.directory === cwd);
  const pick = (here.length ? here : named).sort((a, b) => (b.updated || 0) - (a.updated || 0))[0];
  return pick?.id || null;
}

/**
 * Why the session we just opened is not in opencode's own list.
 *
 * Observed: inside a git checkout `run --title X` is listed and resumable;
 * in a plain directory the run succeeds but never appears, so there is no id to
 * resume. Saying which case this is beats a silent null — the exchange still
 * works (APX carries the thread in the prompt), it just costs a re-read a turn.
 */
function missingSessionReason(cwd) {
  let dir = cwd || process.cwd();
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return "opencode did not list the session it just opened";
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return "opencode keeps no resumable session outside a git repo — the thread travels in the prompt instead";
}

export default {
  id: "opencode",
  binary: "opencode",
  versionFlag: "--version",
  sessions: "capture",

  async run({ system, prompt, cwd, env, timeoutMs, sessionKey = null, resumeSessionId = null, mode = "code" }) {
    const fullPrompt = system ? `${system}\n\n---\n\n${prompt}` : prompt;
    const args = ["run"];
    // `plan` is opencode's own read-only primary agent; `build` (its default)
    // may write. A plain a2a message gets the one that only talks.
    if (mode === "chat") args.push("--agent", "plan");
    if (resumeSessionId) args.push("--session", resumeSessionId);
    else if (sessionKey) args.push("--title", sessionKey);
    args.push(fullPrompt);

    const r = await runProcess({ command: "opencode", args, cwd, env, timeoutMs });

    let sessionId = resumeSessionId || null;
    let sessionNote = null;
    if (!sessionId && sessionKey && r.exitCode === 0) {
      sessionId = await findSessionByTitle({ title: sessionKey, cwd, env });
      if (!sessionId) sessionNote = missingSessionReason(cwd);
    }

    return {
      exitCode: r.exitCode,
      output: cleanOutput(r.stdout),
      stderr: r.stderr,
      killed: r.killed,
      sessionId,
      sessionNote,
      externalSessionPath: null,
    };
  },
};
