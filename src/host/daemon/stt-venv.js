// Which Python runs whisper-server.py.
//
// APX owns a dedicated virtualenv at ~/.apx/runtime/whisper-venv rather than
// installing into the system or user-site Python: mlx-whisper drags in
// torch/scipy/numba and would pollute (or clash with) the user's other
// projects.
//
// This module used to also create that venv and pip-install into it
// (ensureVenv, pipInstall, venvHasModule, removeVenv, ENGINE_PACKAGES). None of
// it was ever called — the installer path was built and then superseded — so it
// was ~120 lines of dead code sitting next to a live one-liner. Removed. If
// venv provisioning comes back, it belongs in its own module with a caller.
import path from "node:path";
import fs from "node:fs";
import { WHISPER_VENV_DIR } from "#core/config/paths.js";

/** Path to the venv's python (…/bin/python on POSIX, …/Scripts on Windows). */
function venvPython() {
  return process.platform === "win32"
    ? path.join(WHISPER_VENV_DIR, "Scripts", "python.exe")
    : path.join(WHISPER_VENV_DIR, "bin", "python");
}

/** True once the venv has a usable interpreter. */
function venvExists() {
  try {
    return fs.existsSync(venvPython());
  } catch {
    return false;
  }
}

/**
 * Interpreter whisper-server.py should run under: the venv if it exists, else
 * the system python3 (legacy path — faster-whisper from the user-site).
 */
export function pythonForWhisper() {
  return venvExists() ? venvPython() : "python3";
}
