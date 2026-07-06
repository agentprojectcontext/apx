// Google Antigravity runtime adapter.
//
// Antigravity ships in two shapes on a machine:
//
//   1. `agy` — a HEADLESS agent CLI (the one we want). It has a non-interactive
//      print mode:  agy -p "<prompt>"  → prints the reply to stdout, so APX can
//      capture the result like any other runtime. This is the preferred path.
//
//   2. `antigravity-ide` — the desktop IDE CLI (a VS Code fork). Its `chat`
//      subcommand LAUNCHES THE GUI and shows the reply inside the editor
//      window; it returns nothing on stdout. It cannot feed a result back to
//      APX, so we only use it as a last-resort "launch the GUI" fallback and we
//      say so explicitly.
//
// Neither binary is guaranteed to be on PATH: `agy` normally installs to
// ~/.local/bin; the IDE CLI lives inside the app bundle. We resolve both.
//
// Result flow: with `agy` we capture stdout directly. If only the IDE is
// present, the reply lives in the GUI and can only reach APX via the runtime
// bridge callback (the in-IDE agent running `apx session close <id> --result`).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runProcess } from "./_spawn.js";

const IDE_BUNDLE_REL = "Contents/Resources/app/bin/antigravity-ide";

function whichSync(bin) {
  const dirs = (process.env.PATH || "").split(path.delimiter);
  for (const d of dirs) {
    if (!d) continue;
    const p = path.join(d, bin);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {}
  }
  return null;
}

function firstExisting(candidates) {
  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c)) return c;
    } catch {}
  }
  return null;
}

// The headless `agy` CLI — the real runtime. Returns an absolute path or null.
export function resolveAgyCli() {
  return (
    whichSync("agy") ||
    firstExisting([
      path.join(os.homedir(), ".local", "bin", "agy"),
      "/usr/local/bin/agy",
      "/opt/homebrew/bin/agy",
    ])
  );
}

// The desktop IDE CLI (GUI). Returns an absolute path or null.
export function resolveAntigravityIde() {
  const home = os.homedir();
  return (
    whichSync("antigravity-ide") ||
    firstExisting([
      path.join("/Applications/Antigravity IDE.app", IDE_BUNDLE_REL),
      path.join(home, "Applications", "Antigravity IDE.app", IDE_BUNDLE_REL),
      "/usr/share/antigravity-ide/bin/antigravity-ide",
      "/opt/Antigravity IDE/bin/antigravity-ide",
      "/opt/antigravity-ide/bin/antigravity-ide",
      path.join(home, ".local", "share", "antigravity-ide", "bin", "antigravity-ide"),
      path.join(process.env.LOCALAPPDATA || "", "Programs", "Antigravity IDE", "bin", "antigravity-ide.cmd"),
    ])
  );
}

// Used by env detection: Antigravity is "installed" if EITHER binary exists.
// We prefer `agy` (the headless CLI) since that's what makes it a usable
// runtime; fall back to the IDE path so detection still reports it as present.
export function resolveAntigravityCli() {
  return resolveAgyCli() || resolveAntigravityIde();
}

export default {
  id: "antigravity",
  binary: "agy",
  versionFlag: "--version",
  resolveBinary: resolveAntigravityCli,

  async run({ system, prompt, cwd, env, timeoutMs }) {
    const fullPrompt = system ? `${system}\n\n---\n\n${prompt}` : prompt;

    // --- Preferred path: headless `agy` print mode (captures the reply) ---
    const agy = resolveAgyCli();
    if (agy) {
      const args = ["--dangerously-skip-permissions"];
      // Bound agy's own wait so it can't hang on the default 5-minute print
      // timeout; leave a little headroom under our own process timeout.
      if (timeoutMs) {
        const secs = Math.max(30, Math.floor(timeoutMs / 1000) - 5);
        args.push("--print-timeout", `${secs}s`);
      }
      args.push("-p", fullPrompt);

      const r = await runProcess({ command: agy, args, cwd, env, timeoutMs });
      const output = r.stdout.trim();
      return {
        exitCode: r.exitCode,
        output:
          output ||
          "[antigravity] agy ran but returned no text. It may need `agy install` " +
            "or an authenticated session — check `agy models`.",
        stderr: r.stderr,
        externalSessionPath: null,
      };
    }

    // --- Fallback: only the desktop IDE is installed (GUI, no capture) ---
    const ide = resolveAntigravityIde();
    if (ide) {
      const r = await runProcess({
        command: ide,
        args: ["chat", "--mode", "agent", "--reuse-window", fullPrompt],
        cwd,
        env,
        timeoutMs,
      });
      return {
        exitCode: r.exitCode,
        output:
          r.stdout.trim() ||
          "[antigravity] no headless `agy` CLI found — handed the prompt to the " +
            "Antigravity IDE (GUI). The reply is shown in the editor, not returned " +
            "to APX. Install the `agy` CLI for headless runs.",
        stderr: r.stderr,
        externalSessionPath: null,
      };
    }

    // --- Nothing installed / enabled ---
    return {
      exitCode: -1,
      output:
        "[antigravity] not available: neither the `agy` headless CLI nor the " +
        "Antigravity IDE was found. Install Antigravity and run `agy install`.",
      stderr: "antigravity runtime unavailable (agy / antigravity-ide not found)",
      externalSessionPath: null,
    };
  },
};
