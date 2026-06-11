// Project-scoped managed files (storagePath/artifacts/).
//   GET    /projects/:pid/artifacts
//   POST   /projects/:pid/artifacts
//   GET    /projects/:pid/artifacts/:name
//   POST   /projects/:pid/artifacts/:name/run        body: { args?: string[] }
//   DELETE /projects/:pid/artifacts/:name
import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import {
  artifactPath,
  createArtifact,
  listArtifacts,
  readArtifact,
  removeArtifact,
} from "#core/stores/artifacts.js";

// Same heuristic as `apx artifact run` (cli/commands/artifact.js): exec bit
// OR shebang counts as runnable. We auto-chmod when shebang-only so the
// web Run button "just works" the way it would from the terminal.
function detectRunnable(absPath) {
  let stat;
  try {
    stat = fs.statSync(absPath);
  } catch {
    return { runnable: false, reason: "not_found" };
  }
  if (!stat.isFile()) return { runnable: false, reason: "not_a_file" };
  const execBit = (stat.mode & 0o111) !== 0;
  let hasShebang = false;
  try {
    const fd = fs.openSync(absPath, "r");
    const buf = Buffer.alloc(2);
    fs.readSync(fd, buf, 0, 2, 0);
    fs.closeSync(fd);
    hasShebang = buf.toString("utf8") === "#!";
  } catch { /* leave hasShebang = false */ }
  if (execBit) return { runnable: true, autoChmod: false };
  if (hasShebang) return { runnable: true, autoChmod: true };
  return { runnable: false, reason: "no_exec_no_shebang" };
}

// Cap stdout/stderr captured per run so a runaway script can't blow up the
// daemon. 256 KiB each — enough for typical script output, small enough to
// fit in one HTTP response without streaming.
const MAX_CAPTURE_BYTES = 256 * 1024;
// Hard timeout for synchronous web execution. Long-running scripts should
// be invoked from the terminal where the user has direct stdio.
const RUN_TIMEOUT_MS = 30_000;

function runArtifact({ absPath, cwd, args, timeoutMs = RUN_TIMEOUT_MS }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(absPath, Array.isArray(args) ? args : [], { cwd });
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    const cap = (s, chunk) => {
      if (s.length >= MAX_CAPTURE_BYTES) { truncated = true; return s; }
      const next = s + chunk.toString("utf8");
      if (next.length > MAX_CAPTURE_BYTES) { truncated = true; return next.slice(0, MAX_CAPTURE_BYTES); }
      return next;
    };
    child.stdout.on("data", (c) => { stdout = cap(stdout, c); });
    child.stderr.on("data", (c) => { stderr = cap(stderr, c); });
    const killer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
      setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* ignore */ } }, 1500);
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(killer);
      resolve({ ok: false, error: err.message, durationMs: Date.now() - started });
    });
    child.on("exit", (code, signal) => {
      clearTimeout(killer);
      resolve({
        ok: !timedOut && code === 0,
        exitCode: code,
        signal,
        timedOut,
        truncated,
        stdout,
        stderr,
        durationMs: Date.now() - started,
      });
    });
  });
}

export function register(app, { project }) {
  app.get("/projects/:pid/artifacts", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    res.json(listArtifacts(p.storagePath));
  });

  app.post("/projects/:pid/artifacts", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { name, content = "" } = req.body || {};
    if (!name) return res.status(400).json({ error: "name required" });
    try {
      const filePath = createArtifact(p.storagePath, name, content);
      res.status(201).json({ name, path: filePath });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/projects/:pid/artifacts/:name", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    try {
      res.json(readArtifact(p.storagePath, decodeURIComponent(req.params.name)));
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  });

  app.patch("/projects/:pid/artifacts/:name", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const name = decodeURIComponent(req.params.name);
    const { content, newName } = req.body || {};
    try {
      const absPath = artifactPath(p.storagePath, name);
      if (!fs.existsSync(absPath)) {
        return res.status(404).json({ error: `artifact "${name}" not found` });
      }
      if (typeof content === "string") {
        fs.writeFileSync(absPath, content, "utf8");
      }
      let finalName = name;
      if (newName && newName !== name) {
        const newAbsPath = artifactPath(p.storagePath, newName);
        fs.renameSync(absPath, newAbsPath);
        finalName = newName;
      }
      res.json({ ok: true, name: finalName });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/projects/:pid/artifacts/:name", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const ok = removeArtifact(
      p.storagePath,
      decodeURIComponent(req.params.name)
    );
    res.status(ok ? 204 : 404).end();
  });

  // Synchronous execute. Web's "Run" button hits this; the terminal CLI uses
  // its own local spawn (stdio inherited) so it can run interactively. Output
  // is captured up to MAX_CAPTURE_BYTES and the call is bounded by
  // RUN_TIMEOUT_MS — anything longer should go through the terminal.
  app.post("/projects/:pid/artifacts/:name/run", async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const name = decodeURIComponent(req.params.name);
    const absPath = artifactPath(p.storagePath, name);
    if (!fs.existsSync(absPath)) {
      return res.status(404).json({ error: `artifact "${name}" not found` });
    }
    const detection = detectRunnable(absPath);
    if (!detection.runnable) {
      return res.status(400).json({
        error: `artifact "${name}" is not runnable`,
        reason: detection.reason,
      });
    }
    if (detection.autoChmod) {
      try {
        const st = fs.statSync(absPath);
        fs.chmodSync(absPath, st.mode | 0o111);
      } catch (e) {
        return res.status(500).json({ error: `chmod failed: ${e.message}` });
      }
    }
    const args = Array.isArray(req.body?.args)
      ? req.body.args.filter((a) => typeof a === "string")
      : [];
    const result = await runArtifact({
      absPath,
      cwd: path.dirname(absPath),
      args,
    });
    res.json(result);
  });
}
