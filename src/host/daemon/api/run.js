// POST /run { cmd, cwd?, project?, timeout_ms? }
// Bash one-shot. `cwd` defaults to the project path (by id), then the first
// non-default registered project, then process.cwd().
import path from "node:path";
import { execFile } from "node:child_process";

export function register(app, { projects }) {
  app.post("/run", (req, res) => {
    const {
      cmd,
      cwd: cwdOverride,
      project: projectRef,
      timeout_ms = 30000,
    } = req.body || {};
    if (!cmd) return res.status(400).json({ error: "cmd required" });

    let cwd = cwdOverride || null;
    if (!cwd) {
      let entry = null;
      if (projectRef !== undefined && projectRef !== null) {
        const all = projects.list();
        const ref = String(projectRef);
        entry = all.find(
          (p) => String(p.id) === ref || p.path === path.resolve(ref)
        );
      }
      if (!entry) {
        const all = projects.list().filter((p) => p.id !== 0);
        entry = all[0] || projects.get(0);
      }
      cwd = entry ? entry.path : process.cwd();
    }

    const timeout = Math.min(
      Math.max(parseInt(timeout_ms, 10) || 30000, 1000),
      300000
    );

    execFile(
      "bash",
      ["-c", cmd],
      { cwd, timeout, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const exit_code = err?.code ?? (err ? 1 : 0);
        res.json({
          ok: !err || exit_code === 0,
          exit_code,
          stdout: stdout || "",
          stderr: stderr || "",
          cwd,
        });
      }
    );
  });
}
