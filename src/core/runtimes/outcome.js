import { runProcess } from "./_spawn.js";
import { detectAll } from "./detect.js";

// Did the runtime actually do the work, and if not, what does the user need to
// hear? Shared by every caller that spawns a CLI — the super-agent's
// `call_runtime` tool and the a2a peer reply — because "exit 0 with nothing on
// stdout" has to mean the same thing on both paths. A second copy of this
// judgement is how one caller starts reporting a logged-out CLI as success.

// A CLI that refuses to work says why in one line — "Not logged in · Please run
// /login", "usage limit reached", "model requires a newer version". That line is
// the whole diagnosis, and an `exit 1` that drops it leaves the model, the
// session record and the daemon log all equally blind. Prefer stderr (where
// CLIs put refusals), fall back to stdout (claude -p puts them in .result).
// A machine-readable runtime answers in JSON; pasting the envelope would bury
// the sentence inside it, so unwrap the field that carries the message.
// Lines that carry a diagnosis rather than the machinery around it.
const STACK_FRAME = /^(at\s|\.\.\.\s|Node\.js v)/;
const DIAGNOSIS = /(error|failed|denied|invalid|expired|not logged|log ?in|usage limit|quota|unauthor|forbidden|not found|missing|required)/i;

export function diagnosticLine(r) {
  const pick = String(r?.stderr || "").trim() || String(r?.output || "").trim();
  if (!pick) return "";
  // A crashing CLI ends on `at async main (…cli.js:539307:5)`, which says
  // nothing. Prefer the last line that reads like a cause; a stack frame is
  // never one, and blindly taking the last line reported a 401 as a file path.
  const lines = pick.split("\n").map((l) => l.trim()).filter(Boolean);
  const meaningful = lines.filter((l) => !STACK_FRAME.test(l));
  const line =
    meaningful.filter((l) => DIAGNOSIS.test(l)).pop() ||
    meaningful.pop() ||
    lines.pop() ||
    "";
  if (line.startsWith("{")) {
    try {
      const o = JSON.parse(line);
      const msg = o.result || o.error?.message || o.error || o.message;
      if (typeof msg === "string" && msg.trim()) return msg.trim().slice(0, 160);
    } catch { /* not JSON after all — fall through to the raw line */ }
  }
  return line.slice(0, 160);
}

// Decide if the runtime actually did the work the caller asked for. A spawn
// failure (-1), a non-zero exit, or a clean exit with no captured output and
// no transcript path all point at "process didn't really run" — exactly the
// false-positive scenario this guard exists to catch.
export function runtimeLooksLikeFailure(r, { timedOut = false, timeoutS = 0 } = {}) {
  if (!r) return { failed: true, reason: "no runtime result" };
  if (r.exitCode === -1 || r.error) {
    return { failed: true, reason: r.error || "spawn error" };
  }
  // Order matters: we SIGTERM'd it ourselves, so whatever it exits with is our
  // own signal echoed back. Reading that as the CLI's verdict would report a
  // timeout as a crash — or, when the exit code is null, as "empty output".
  // `r.killed` only arrives from adapters that bother to forward it; the clock
  // is what every runtime has in common, so it decides.
  if (timedOut || r.killed) {
    return { failed: true, reason: `killed (timeout after ${timeoutS}s)` };
  }
  if (typeof r.exitCode === "number" && r.exitCode !== 0) {
    const why = diagnosticLine(r);
    return { failed: true, reason: why ? `exit ${r.exitCode}: ${why}` : `exit ${r.exitCode}` };
  }
  const out = String(r.output || "").trim();
  const stderr = String(r.stderr || "").trim();
  if (!out && !r.externalSessionPath && !r.sessionId) {
    return {
      failed: true,
      reason: stderr ? `empty output (stderr: ${stderr.slice(0, 120)})` : "empty output",
    };
  }
  return { failed: false };
}

// How long we wait for `<binary> --version` before giving up on the answer.
// Not how long we wait for the runtime itself — that is the caller's timeout.
export const PROBE_TIMEOUT_MS = 3000;

/**
 * Can this runtime run at all? Answered BEFORE spawning it for real, because
 * "spawn error" is a useless thing to tell someone whose CLI is simply not
 * installed. Shared with the super-agent's call_runtime tool so a missing
 * binary reads the same however it was reached.
 */
export async function runtimeAvailability(runtime, rt, { probeTimeoutMs = PROBE_TIMEOUT_MS } = {}) {
  const probe = await runProcess({
    command: rt.binary,
    args: rt.versionFlag ? [rt.versionFlag] : ["--version"],
    timeoutMs: probeTimeoutMs,
  });
  if (probe.exitCode === 0 || probe.stdout || probe.stderr) {
    return { ok: true };
  }
  // A probe WE killed is not evidence of absence — it is evidence of presence.
  // A binary that is not there fails at spawn (ENOENT, exitCode -1) and never
  // gets far enough to be killed, so `killed` can only mean the binary exists,
  // started, and was slower than our clock. Under load `--version` really does
  // take longer than three seconds, and reading that as "not installed" refused
  // to run a CLI sitting right there — then fell into detectAll() below, which
  // spawns EVERY coding CLI on the machine to reach a verdict we already had.
  if (probe.killed) {
    return { ok: true };
  }

  const detected = await detectAll();
  const current = detected.find((d) => d.id === runtime || d.binary === rt.binary);
  if (current?.installed) {
    return { ok: true, detected };
  }
  return {
    ok: false,
    reason: current?.reason || `${rt.binary} not found`,
    detected,
    installed: detected
      .filter((d) => d.category === "runtime" && d.installed)
      .map((d) => d.id),
  };
}
