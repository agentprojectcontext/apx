// One WebSocket, one terminal, one session.
//
// The Sessions list can tell you a conversation exists and hand you the command
// that reopens it, but pasting that command somewhere else is a context switch
// away from the thing you were reading. This channel closes the gap: the daemon
// runs the session's own CLI on a real pty and relays it to a terminal in the
// web UI.
//
// Deliberately NOT a shell. The socket says which session to reopen — engine +
// id — and the daemon derives the command from the engine that owns it
// (see resumeArgvFor). A client cannot ask for an arbitrary command, so the
// channel's blast radius is "the CLIs APX already knows how to launch" rather
// than "anything on the machine". Whatever the user then types INTO claude or
// opencode is between them and that tool, exactly as in their own terminal.
//
// The wire protocol is the absence of one: every frame is bytes. Client frames
// are keystrokes for the pty; server frames are output to draw. Status lines
// from APX itself are written into the same stream, which is why they carry a
// [apx] prefix — there is no side channel to confuse them with.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { apiPath } from "./api/prefix.js";
import { findSessionAcrossEngines, findSessionInEngine, resumeArgvFor } from "#core/sessions/index.js";

/** The terminal channel's upgrade path. Lives under /api like every other route. */
export const TERMINAL_WS_PATH = apiPath("/terminal/ws");

const BRIDGE = path.join(path.dirname(fileURLToPath(import.meta.url)), "pty-bridge.py");

/** Path-gate: is this upgrade for the terminal WS channel? */
export function isTerminalUpgradePath(url) {
  let pathname = url || "";
  try { pathname = new URL(url, "http://localhost").pathname; } catch { /* keep raw */ }
  return pathname === TERMINAL_WS_PATH;
}

/** Terminal geometry, clamped: a bad number here misdraws the whole session. */
function readSize(params) {
  const n = (key, dflt, min, max) => {
    const v = Number(params.get(key));
    return Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : dflt;
  };
  return { rows: n("rows", 30, 4, 200), cols: n("cols", 100, 20, 500) };
}

/**
 * Resolve which command reopens the session named on the query string, and
 * where to run it. Returns a `problem` instead of throwing — the socket is
 * already open, so every failure has to be something we can print in it.
 */
export function resolveTerminalTarget(params, { home = os.homedir() } = {}) {
  const id = String(params.get("id") || "");
  const engineParam = String(params.get("engine") || "");
  if (!id) return { problem: "no session id given" };

  let meta = null;
  try {
    meta = engineParam ? findSessionInEngine(engineParam, id) : (findSessionAcrossEngines(id)[0] || null);
  } catch { meta = null; }

  // An engine we were told about is enough to build the command: a session the
  // engine hasn't flushed to disk yet still deserves to open.
  const engine = engineParam || meta?.engine || null;
  const argv = engine ? resumeArgvFor(engine, id) : null;
  if (!argv) {
    return { problem: engine ? `engine "${engine}" cannot reopen a session from the terminal` : "unknown session" };
  }

  // Run where the conversation happened, so relative paths in it still mean
  // what they meant. Engines that don't record a cwd land in the home dir.
  const cwd = meta?.cwd && fs.existsSync(meta.cwd) ? meta.cwd : home;
  return { argv, cwd, engine, id };
}

/**
 * Attach a live terminal to `ws`. Spawns the pty bridge, relays bytes both
 * ways, and makes sure neither side can outlive the other: closing the socket
 * kills the CLI, and the CLI exiting closes the socket.
 */
export function startTerminalSession(ws, req, { python = "python3", home = os.homedir() } = {}) {
  const say = (line) => { try { if (ws.readyState === 1) ws.send(Buffer.from(`\r\n[apx] ${line}\r\n`)); } catch {} };

  let params;
  try { params = new URL(req.url || "", "http://localhost").searchParams; } catch { params = new URLSearchParams(); }

  const target = resolveTerminalTarget(params, { home });
  if (target.problem) {
    say(target.problem);
    try { ws.close(); } catch {}
    return null;
  }

  const { rows, cols } = readSize(params);
  let child;
  try {
    child = spawn(python, [BRIDGE, String(rows), String(cols), ...target.argv], {
      cwd: target.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (e) {
    say(`could not start a terminal: ${e.message}`);
    try { ws.close(); } catch {}
    return null;
  }

  say(`${target.argv.join(" ")}   (${target.cwd})`);

  child.on("error", (e) => {
    // python3 missing is the realistic case, and it is worth naming: without it
    // there is no pty, and the panel would otherwise just sit there empty.
    say(`terminal unavailable: ${e.message}`);
    try { ws.close(); } catch {}
  });
  child.stdout.on("data", (chunk) => { try { if (ws.readyState === 1) ws.send(chunk); } catch {} });
  child.stderr.on("data", (chunk) => { try { if (ws.readyState === 1) ws.send(chunk); } catch {} });
  child.on("close", (code) => {
    say(`session ended (exit ${code ?? "?"})`);
    try { ws.close(); } catch {}
  });

  ws.on("message", (raw) => {
    try { child.stdin.write(Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw))); } catch {}
  });
  const stop = () => { try { child.kill("SIGTERM"); } catch {} };
  ws.on("close", stop);
  ws.on("error", stop);

  return child;
}
