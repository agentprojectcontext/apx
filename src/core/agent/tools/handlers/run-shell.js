import { spawn } from "node:child_process";
import { resolveProject, safePathJoin } from "../helpers.js";

function run(command, { cwd, timeoutMs, abortSignal }) {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-lc", command], { cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    const onAbort = () => {
      child.kill("SIGTERM");
    };
    if (abortSignal) {
      if (abortSignal.aborted) onAbort();
      else abortSignal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      abortSignal?.removeEventListener("abort", onAbort);
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

// Commands that stop or restart the daemon this tool is running INSIDE.
// Killing your own host mid-turn is not a dangerous-but-valid action, it is a
// guaranteed loss: the process dies, every in-flight turn dies with it, the
// stream to the user is cut, and the work of the turn is gone with no report.
// Seen in production — an agent that had just edited a handler ran `apx restart`
// "to load the new code" and executed itself two steps from finishing.
//
// Checked per command SEGMENT, so `cd x && apx restart` and
// `sleep 1; apx daemon stop` are both caught, while a segment that merely
// mentions the command — `echo "run apx restart when I'm done"` — is not.
const SELF_KILL_RE =
  /^(?:apx\s+(?:restart\b|daemon\s+(?:restart|stop|kill)\b)|(?:pkill|killall)\b.*\bapx[-\s]?daemon\b)/i;

export function killsOwnDaemon(command) {
  return String(command || "")
    .split(/\s*(?:;|\||&&|\|\|)\s*/)
    .some((segment) => SELF_KILL_RE.test(segment.trim()));
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
  makeHandler: (ctx) => async ({ project, cwd = ".", command, timeout_s = 60, confirmed = false }) => {
    const { projects, requirePermission, abortSignal } = ctx;
    await requirePermission("run_shell", { dangerous: !isSafeShellCommand(command), confirmed, args: { command } });
    if (!command) throw new Error("run_shell: command required");
    if (killsOwnDaemon(command)) {
      // An error, not a confirmation prompt: there is no answer that makes this
      // succeed. Say why, and say what to do instead — code the agent just wrote
      // is loaded by a restart the USER runs, after the turn has reported back.
      return {
        error:
          "refused: that command restarts or stops the APX daemon you are running inside. " +
          "It would kill this turn before you could report anything. Finish the work and tell " +
          "the user to run it — a daemon restart is theirs to make, not something to do mid-turn.",
        command,
      };
    }

    const p = resolveProject(projects, project);
    const workingDir = safePathJoin(p.path, cwd);
    const result = await run(command, {
      cwd: workingDir,
      timeoutMs: Math.max(1, Math.min(timeout_s, 600)) * 1000,
      abortSignal,
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
