import { spawn } from "node:child_process";
import { resolveProject, safePathJoin } from "../helpers.js";

function run(command, { cwd, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-lc", command], { cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, timedOut, stdout, stderr });
    });
  });
}

function isSafeShellCommand(command) {
  const text = String(command || "").trim();
  if (!text) return false;
  if (/[`$<>]/.test(text)) return false;
  if (/\b(rm|mv|cp|chmod|chown|mkdir|touch|tee|kill|pkill|npm\s+install|curl\s+-X|apx\s+routine\s+(add|remove|rm|enable|disable|run)|apx\s+config\s+set)\b/i.test(text)) {
    return false;
  }

  const segments = text.split(/\s*(?:\||&&|\|\|)\s*/).filter(Boolean);
  return segments.every((segment) => {
    const cmd = segment.trim().split(/\s+/)[0];
    if (["pwd", "ls", "find", "rg", "grep", "cat", "head", "tail", "sed", "wc", "date", "stat", "file", "du", "df", "whoami", "id", "uname", "echo"].includes(cmd)) {
      return true;
    }
    if (cmd === "docker") return /^docker\s+ps\b/.test(segment.trim());
    if (cmd === "apx") {
      return /^apx\s+(--help|-h|help|status|daemon\s+status|routine\s+(list|ls|get|show)\b|project\s+(list|ls)\b|agent\s+(list|ls)\b|config\s+(show|ls)\b)/.test(segment.trim());
    }
    return false;
  });
}

export default {
  name: "run_shell",
  schema: {
    type: "function",
    function: {
      name: "run_shell",
      description: "Run a shell command in default or a project working directory. Direct command execution tool.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string" },
          cwd: { type: "string", description: "relative working directory inside the selected project; default '.'" },
          command: { type: "string" },
          timeout_s: { type: "integer", description: "seconds before SIGTERM; default 60" },
        },
        required: ["command"],
      },
    },
  },
  makeHandler: ({ projects, requirePermission }) => async ({ project, cwd = ".", command, timeout_s = 60, confirmed = false }) => {
    await requirePermission("run_shell", { dangerous: !isSafeShellCommand(command), confirmed, args: { command } });
    if (!command) throw new Error("run_shell: command required");

    const p = resolveProject(projects, project);
    const workingDir = safePathJoin(p.path, cwd);
    const result = await run(command, {
      cwd: workingDir,
      timeoutMs: Math.max(1, Math.min(timeout_s, 600)) * 1000,
    });
    return {
      exit_code: result.code,
      signal: result.signal,
      timed_out: result.timedOut,
      stdout: result.stdout.slice(0, 12000),
      stderr: result.stderr.slice(0, 12000),
      truncated: result.stdout.length > 12000 || result.stderr.length > 12000,
      cwd: workingDir,
    };
  },
};
