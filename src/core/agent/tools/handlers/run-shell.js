import { spawn } from "node:child_process";
import { SUPERAGENT_ACTOR_ID } from "#core/constants/actors.js";
import { DEFAULT_JOB_TIMEOUT_S } from "#core/stores/background-jobs.js";
import { runShellInBackground, MAX_SHELL_JOB_TIMEOUT_S } from "#core/agent/shell/background.js";
import { shellCommand, killChild } from "#core/util/shell.js";
import { resolveProject, safePathJoin } from "../helpers.js";

/** The longest a FOREGROUND command may be asked to wait. The tool's own
 *  ceiling, and the number the loop's watchdog is derived from below. */
const MAX_FOREGROUND_TIMEOUT_S = 600;
const DEFAULT_FOREGROUND_TIMEOUT_S = 60;

// Run a command and wait for it.
//
// EVERY EXIT FROM HERE HAS TO SETTLE THE PROMISE, and one of them did not.
// There was no `error` listener — the background sibling has had one all along,
// this path never did — and a spawn that cannot start (no `sh` on the box,
// which is every Windows install without Git Bash; a cwd that no longer exists;
// a full process table) fails asynchronously with ENOENT.
//
// The part that is easy to get wrong, and worth writing down because it was got
// wrong here first: an unlistened `error` on a ChildProcess is THROWN, and the
// throw happens inside the same tick that would go on to emit `close`. So
// `close` never arrives. (With a listener attached, `error` is followed by
// `close(-2)` — which is what a probe written with a listener shows, and why
// the first read of this bug was talked out of itself. Measured both ways,
// 2026-09-19.)
//
// The result in production: the daemon's uncaughtException handler logs the
// ENOENT and keeps running by design, and this promise never settles. The turn
// waits forever — past the tool's own timeout, which only sends a signal and
// resolves nothing, and past Stop, which the loop only read between tool calls.
// The chat simply never answers again. Reported from the outside on 2026-09-18
// as an action that "hangs waiting and will not let you interrupt or cancel".
//
// So: `error` settles with a NAMED failure the caller turns into an error
// result, `close` settles, the timeout escalates to SIGKILL so a child that
// ignores SIGTERM cannot hold `close` back indefinitely, and an abort settles
// on its own rather than waiting for a kill to be honoured — whether the person
// has stopped waiting is a different question from whether the process died.
function run(command, { cwd, timeoutMs, abortSignal }) {
  return new Promise((resolve) => {
    const { file, args, options } = shellCommand(command, { login: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let cancelKill = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cancelKill?.();
      abortSignal?.removeEventListener("abort", onAbort);
      resolve(result);
    };

    let child;
    try {
      child = spawn(file, args, { cwd, env: process.env, ...options });
    } catch (e) {
      // Synchronous throws (an invalid cwd on some platforms) never reach the
      // `error` event at all.
      return resolve({ code: null, signal: null, timedOut: false, stdout: "", stderr: "", spawnError: e?.message || String(e) });
    }

    const timer = setTimeout(() => {
      timedOut = true;
      cancelKill = killChild(child);
    }, timeoutMs);

    // Stop has to land even if the child refuses to die: the point of the abort
    // is that the PERSON stops waiting, which is not the same question as
    // whether the process did.
    const onAbort = () => {
      cancelKill = killChild(child);
      finish({ code: null, signal: "SIGTERM", timedOut, stdout, stderr, aborted: true });
    };
    if (abortSignal) {
      if (abortSignal.aborted) onAbort();
      else abortSignal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout?.on("data", (d) => { stdout += d.toString(); });
    child.stderr?.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (e) => {
      finish({ code: null, signal: null, timedOut, stdout, stderr, spawnError: e?.message || String(e) });
    });
    child.on("close", (code, signal) => {
      finish({ code, signal, timedOut, stdout, stderr });
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
      description:
        "Run a shell command in default or a project working directory. Direct command execution tool. " +
        "Waits for the command by default — so anything that takes minutes (a render, an encode, a build, " +
        "a batch) must be launched with `background: true` instead, or it dies on the timeout.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string" },
          cwd: { type: "string", description: "relative working directory inside the selected project; default '.'" },
          command: { type: "string" },
          timeout_s: {
            type: "integer",
            description:
              `seconds before the command is killed. Default 60 waiting (600 max), ` +
              `${DEFAULT_JOB_TIMEOUT_S} in background (${MAX_SHELL_JOB_TIMEOUT_S} max).`,
          },
          background: {
            type: "boolean",
            description:
              "Leave the command running instead of waiting for it. Default false: you wait, and the output " +
              "is this tool's result — right for anything that answers in seconds. Set TRUE for work that " +
              "takes MINUTES: a render, an encode, a build, a long batch. You get a job id back immediately " +
              "and carry on in the same turn; the owner sees it running in the background-work panel, with " +
              "the tail of its output updating live, and can stop it there. Waiting instead is not merely " +
              "slower — a foreground command is killed at 600s at the very most, so a twelve-minute render " +
              "cannot succeed that way at all.",
          },
          wake_me: {
            type: "boolean",
            description:
              "Only with background. Default TRUE: when the command exits you are woken as a new turn in " +
              "this same chat, carrying the command, its exit code and the tail of its output, and you carry " +
              "on from there. Set false ONLY for something whose outcome you will never need. Your context " +
              "is NOT kept while it runs, so anything you will need afterwards must be discoverable from the " +
              "command itself or from files on disk.",
          },
        },
        required: ["command"],
      },
    },
  },
  makeHandler: (ctx) => async ({ project, cwd = ".", command, timeout_s, confirmed = false, background = false, wake_me = true }) => {
    const { projects, requirePermission, abortSignal, channel, channelMeta } = ctx;
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

    if (background) {
      // WHO gets woken, decided the same way `send_to_agent` decides who is
      // writing: a project agent's turn stamps its slug on the tool context and
      // the super-agent's does not. Never taken from an argument — a waiter the
      // caller can name is a turn the caller can start in somebody else's chat.
      const from = channelMeta?.agentSlug || SUPERAGENT_ACTOR_ID;
      // The wake-up runs a turn in an agent's own conversation, and the
      // super-agent has none — its thread IS its channel (see api/super-agent.js).
      // So the job is still opened, watched and cancellable, and the note below
      // says plainly that nothing will come back for it, rather than promising a
      // wake-up that never arrives.
      const wakeable = !!channelMeta?.agentSlug;
      const launched = runShellInBackground({
        project: p,
        from,
        command,
        cwd: workingDir,
        timeout_s: timeout_s ?? DEFAULT_JOB_TIMEOUT_S,
        wake: wakeable && wake_me !== false,
        origin: {
          channel: channel || null,
          // Absent on a routine or a Telegram turn; the wake-up opens a fresh
          // chat thread in that case rather than dropping the result.
          conversation_id: channelMeta?.conversation_id || null,
        },
      });
      if (launched.ok && wake_me !== false && !wakeable) {
        launched.wake = false;
        launched.note =
          `Launched, but NOBODY WILL WAKE YOU: being woken means a turn in an agent's own chat, and this ` +
          `turn is the super-agent's, whose thread is its channel. The job runs, the owner can watch and ` +
          `stop it in the background-work panel, and its output is at ${launched.log_path} — but nothing ` +
          `will bring you back when it ends. Say that when you report it, and hand work like this to a ` +
          `project agent if somebody needs to act on the result.`;
      }
      return launched;
    }

    const result = await run(command, {
      cwd: workingDir,
      timeoutMs: foregroundTimeoutS(timeout_s) * 1000,
      abortSignal,
    });
    // A command that never started is an ERROR, not an exit code of null with
    // empty output. The model reads `stdout: ""` as "it ran and printed
    // nothing" and carries on building on a step that did not happen — which is
    // how a Windows box with no `sh` produced a turn that believed its own work.
    if (result.spawnError) {
      return {
        error: `the command could not be started: ${result.spawnError}`,
        command,
        cwd: workingDir,
        shell: shellCommand(command, { login: true }).file,
      };
    }
    return {
      exit_code: result.code,
      signal: result.signal,
      timed_out: result.timedOut,
      ...(result.aborted ? { aborted: true } : {}),
      stdout: result.stdout.slice(0, 12000),
      stderr: result.stderr.slice(0, 12000),
      truncated: result.stdout.length > 12000 || result.stderr.length > 12000,
      cwd: workingDir,
    };
  },

  // What the loop's watchdog gives this tool before it calls the call hung
  // (core/agent/loop/tool-watchdog.js). Derived from the tool's OWN ceiling
  // rather than guessed: a watchdog that fires earlier than the timeout the
  // tool is honouring would kill legitimate work, and one that never fires is
  // the bug this whole file is about. Background launches return immediately,
  // so only the foreground wait is in question.
  deadlineMs: ({ background, timeout_s } = {}) =>
    (background ? 30 : foregroundTimeoutS(timeout_s) + 30) * 1000,
};

/** The foreground wait, clamped to the tool's own ceiling. One home for the
 *  number so the watchdog above and the timer in `run` cannot disagree. */
function foregroundTimeoutS(timeout_s) {
  return Math.max(1, Math.min(Number(timeout_s) || DEFAULT_FOREGROUND_TIMEOUT_S, MAX_FOREGROUND_TIMEOUT_S));
}
