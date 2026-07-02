// POST /admin/reload     — re-read ~/.apx/config.json into the live config
//                          object and propagate to scheduler/plugins.
// POST /admin/shutdown    — clean exit (50 ms grace so the response flushes).
//
// Both are auth-gated (the global middleware applies).
import { readConfig } from "#core/config/index.js";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function register(app, { scheduler, plugins, config, registries }) {
  // Daemon logs: errors.jsonl (structured) or apx.log (plain), newest first.
  app.get("/admin/logs", (req, res) => {
    const dir = path.join(os.homedir(), ".apx", "logs");
    const which = req.query.file === "apx" ? "apx.log" : "errors.jsonl";
    const file = path.join(dir, which);
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 2000);
    if (!fs.existsSync(file)) return res.json({ file: which, entries: [], lines: [] });
    const all = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    const tail = all.slice(-limit).reverse();
    if (which === "errors.jsonl") {
      const entries = tail.map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } });
      return res.json({ file: which, entries });
    }
    res.json({ file: which, lines: tail });
  });

  app.post("/admin/reload", (_req, res) => {
    try {
      const fresh = readConfig();
      // Mutate in place so every closure that captured `config` sees the new
      // values (super-agent, model router, telegram, …).
      for (const key of Object.keys(config)) delete config[key];
      Object.assign(config, fresh);
      if (scheduler) scheduler.globalConfig = config;
      if (plugins) plugins.config = config;
      if (registries) registries.shutdown();
      res.json({
        ok: true,
        super_agent_model: config.super_agent?.model || null,
        fallback_order: config.super_agent?.model_fallback?.order || [],
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/admin/shutdown", (_req, res) => {
    res.json({ ok: true });
    setTimeout(() => process.exit(0), 50);
  });

  // Opens the OS-native folder picker on the daemon host and resolves with
  // the absolute path the user chose. macOS uses osascript; Linux uses
  // zenity (if present); Windows uses PowerShell's Shell.Application. If the
  // platform lacks a usable picker — or none is installed — the endpoint
  // returns 501 so the frontend can fall back to the inline directory list.
  app.get("/admin/fs/pick-dir", (req, res) => {
    // The prompt is attacker-controllable (query string). NEVER interpolate it
    // into a shell string — use execFile (no shell) with an argv array, and
    // pass the prompt out-of-band via an env var so it can't break out of any
    // quoting context in the picker's own scripting language.
    const prompt = String(req.query.prompt || "Select a folder");
    const platform = process.platform;
    const env = { ...process.env, APX_PICK_PROMPT: prompt };
    let file;
    let args;
    if (platform === "darwin") {
      // try/end-try makes cancel exit with code 0 + empty stdout so we can
      // distinguish "cancelled" from "no picker available". `system attribute`
      // reads the env var, so the prompt never touches the AppleScript source.
      file = "osascript";
      args = [
        "-e", "try",
        "-e", 'POSIX path of (choose folder with prompt (system attribute "APX_PICK_PROMPT"))',
        "-e", "on error",
        "-e", 'return ""',
        "-e", "end try",
      ];
    } else if (platform === "linux") {
      // zenity takes the title as a plain argv value — no shell, no escaping.
      file = "zenity";
      args = ["--file-selection", "--directory", `--title=${prompt}`];
    } else if (platform === "win32") {
      // Reference the prompt via $env: inside PowerShell rather than splicing it
      // into the -Command string.
      file = "powershell";
      args = [
        "-NoProfile",
        "-Command",
        "$f = (New-Object -ComObject Shell.Application).BrowseForFolder(0, $env:APX_PICK_PROMPT, 0, 0); if ($f) { $f.Self.Path }",
      ];
    } else {
      return res.status(501).json({ error: "Native folder picker not supported on this platform" });
    }
    execFile(file, args, { timeout: 5 * 60 * 1000, env }, (err, stdout) => {
      if (err) {
        // Picker binary absent (e.g. no zenity) → let the frontend fall back to
        // the inline directory list instead of surfacing a hard 500.
        if (err.code === "ENOENT") {
          return res.status(501).json({ error: "Native folder picker not available" });
        }
        return res.status(500).json({ error: err.message });
      }
      const picked = (stdout || "").trim().replace(/[\r\n]+$/g, "");
      if (!picked) return res.json({ cancelled: true });
      res.json({ path: picked.replace(/\/+$/, "") });
    });
  });

  app.get("/admin/fs/dirs", (req, res) => {
    const requested = String(req.query.path || os.homedir());
    const base = path.resolve(requested.replace(/^~(?=$|\/)/, os.homedir()));
    try {
      const stat = fs.statSync(base);
      const dir = stat.isDirectory() ? base : path.dirname(base);
      const entries = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => path.join(dir, entry.name))
        .sort((a, b) => a.localeCompare(b));
      res.json({
        path: dir,
        parent: path.dirname(dir) === dir ? null : path.dirname(dir),
        entries,
      });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
}
