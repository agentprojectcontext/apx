// Dedicated Python virtualenv for the STT engines.
//
// We never install into the system or user-site Python — mlx-whisper drags in
// torch/scipy/numba and would pollute (or clash with) the user's other
// projects. Instead APX owns ~/.apx/runtime/whisper-venv: create it, install
// faster-whisper / mlx-whisper into it, and spawn whisper-server.py with its
// interpreter. "Reset the engine" = delete the folder and recreate it.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";

export const VENV_DIR = path.join(os.homedir(), ".apx", "runtime", "whisper-venv");

/** Path to the venv's python (…/bin/python on POSIX, …/Scripts on Windows). */
export function venvPython() {
  return process.platform === "win32"
    ? path.join(VENV_DIR, "Scripts", "python.exe")
    : path.join(VENV_DIR, "bin", "python");
}

/** True once the venv has a usable interpreter. */
export function venvExists() {
  try { return fs.existsSync(venvPython()); } catch { return false; }
}

/**
 * Interpreter whisper-server.py should run under: the venv if it exists, else
 * the system python3 (legacy path — faster-whisper from the user-site).
 */
export function pythonForWhisper() {
  return venvExists() ? venvPython() : "python3";
}

function run(cmd, args, onLine) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      onLine?.(`spawn failed: ${e.message}`);
      return resolve({ ok: false, code: -1 });
    }
    const pump = (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (line.trim()) onLine?.(line);
      }
    };
    proc.stdout.on("data", pump);
    proc.stderr.on("data", pump);
    proc.on("exit", (code) => resolve({ ok: code === 0, code }));
    proc.on("error", (e) => { onLine?.(e.message); resolve({ ok: false, code: -1 }); });
  });
}

/** Create the venv (idempotent). Streams progress lines to onLine. */
export async function ensureVenv(onLine) {
  if (venvExists()) return { ok: true, created: false };
  fs.mkdirSync(path.dirname(VENV_DIR), { recursive: true });
  onLine?.(`creating venv at ${VENV_DIR}…`);
  const r = await run("python3", ["-m", "venv", VENV_DIR], onLine);
  if (!r.ok || !venvExists()) return { ok: false, error: "venv creation failed" };
  // Upgrade pip once so wheel resolution is fast/modern.
  await run(venvPython(), ["-m", "pip", "install", "--upgrade", "pip", "wheel"], onLine);
  return { ok: true, created: true };
}

/** Is a module importable inside the venv? */
export function venvHasModule(mod) {
  return new Promise((resolve) => {
    if (!venvExists()) return resolve(false);
    const p = spawn(venvPython(), ["-c", `import ${mod}`], { stdio: "ignore" });
    p.on("exit", (code) => resolve(code === 0));
    p.on("error", () => resolve(false));
  });
}

/** pip install <pkgs> into the venv, streaming progress. Creates the venv first. */
export async function pipInstall(pkgs, onLine) {
  const ensured = await ensureVenv(onLine);
  if (!ensured.ok) return ensured;
  const list = Array.isArray(pkgs) ? pkgs : [pkgs];
  onLine?.(`installing ${list.join(", ")}…`);
  const r = await run(venvPython(), ["-m", "pip", "install", "--upgrade", ...list], onLine);
  return { ok: r.ok, code: r.code };
}

/** Delete the whole venv (so the engine can be reinstalled clean). */
export async function removeVenv(onLine) {
  if (!fs.existsSync(VENV_DIR)) return { ok: true, removed: false };
  onLine?.(`removing ${VENV_DIR}…`);
  await fs.promises.rm(VENV_DIR, { recursive: true, force: true });
  return { ok: !fs.existsSync(VENV_DIR), removed: true };
}

/** Engine → the pip package(s) it needs in the venv. */
export const ENGINE_PACKAGES = {
  faster: ["faster-whisper"],
  mlx: ["mlx-whisper"],
};
