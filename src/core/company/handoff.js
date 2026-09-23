// The handoff — the only way out of the executive layer.
//
// The agent has no channel. It writes a brief and this decides what happens to
// it: checked against the rubric, weighed by the guard, and handed to the
// super-agent over a2a with a severity. The super-agent owns the relationship
// with the owner and decides timing and channel; `blocker` is the only
// severity that asks it to cross quiet hours.
//
// Why this is code and not a line in a prompt: "never message the owner
// directly" is a boundary, and a boundary that lives in a prompt is a request.
// The routine has no channel step at all — this function is the only delivery
// path, and it can only reach one recipient.
import { execFileSync } from "node:child_process";
import { decide, parseSeverity } from "./guard.js";
import { formatFindings, lint } from "./lint.js";
import { appendEntry, readLedger } from "./ledger.js";
import { ledgerFile } from "./context.js";
import { ritualOrThrow } from "./policy.js";

/**
 * Only a `blocker` opens a turn. A `status` or `fyi` is FILED: written to the
 * a2a thread as a message for the super-agent, where the secretary's a2a
 * sweep and the day briefs pick it up — nobody runs a model because a report
 * arrived.
 *
 * It used to be `--deliver --background` for every severity. On 2026-09-23
 * that was the start of the cascade: each routine brief opened a full
 * super-agent turn with every tool, the turn read `[status]` as orders
 * ("Urgente: verificá…"), delegated, and every answer woke it again — ~230
 * a2a turns in under an hour, nobody watching, nothing urgent.
 *
 * `--background` stays for the blocker: the call hands the message to the
 * thread and returns instead of waiting out the super-agent's whole turn, which
 * on a busy daemon outlived the timeout and filed a delivered brief as
 * `failed`. The daemon also pings the owner for a blocker itself, before the
 * turn runs.
 */
export function deliveryArgs({ from, orchestrator, body, severity, project }) {
  return [
    "send", from, orchestrator, body,
    "--severity", severity,
    ...(severity === "blocker" ? ["--deliver", "--background"] : []),
    ...(project ? ["--project", project] : []),
  ];
}

function deliverViaApx(payload) {
  return execFileSync("apx", deliveryArgs(payload), {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
  });
}

/**
 * @returns {{action:string, reason:string, severity:string, hash:string,
 *            findings:object[], reply:string|null}}
 */
export function handoff({
  brief,
  ritual,
  project,
  policy,
  orchestrator,
  now = new Date(),
  sources = "",
  dryRun = false,
  deliver = deliverViaApx,
} = {}) {
  const definition = ritualOrThrow(ritual);
  const file = ledgerFile(project.path, policy);
  const { severity: declared, body } = parseSeverity(brief, definition.severity);
  const record = (entry) => {
    if (!dryRun) appendEntry({ at: now, ritual, sources, ...entry }, file);
  };

  // The rubric runs first and unconditionally: a brief that breaks the contract
  // does not get to be weighed, it gets to be fixed next run.
  const rubric = lint(body, { ritual, maxChars: policy.maxBriefChars });
  if (!rubric.ok) {
    const reason = formatFindings(rubric.findings);
    record({ action: "rejected", severity: declared, hash: "—", reason, body });
    return { action: "rejected", reason, severity: declared, hash: "—", findings: rubric.findings, reply: null };
  }

  const verdict = decide({ brief, ritual, now, history: readLedger(file), policy });
  if (verdict.action !== "send") {
    record({ ...verdict, body: verdict.body });
    return { ...verdict, findings: [], reply: null };
  }

  // A dry run decides and explains; it neither delivers nor writes. The point
  // is to ask "what would happen" without spending one of the week's
  // interruptions.
  if (dryRun) {
    return { ...verdict, reason: `${verdict.reason} (dry run: not delivered)`, findings: [], reply: null };
  }

  let reply = null;
  try {
    reply = deliver({
      from: policy.agent,
      orchestrator,
      body: verdict.body,
      severity: verdict.severity,
      project: project.name,
    })?.trim() ?? "";
  } catch (error) {
    const reason = `Could not deliver to @${orchestrator}: ${error.message}`;
    record({ action: "failed", severity: verdict.severity, hash: verdict.hash, reason, body: verdict.body });
    return { ...verdict, action: "failed", reason, findings: [], reply: null };
  }

  record({ ...verdict, reason: `${verdict.reason} Delivered to @${orchestrator}.`, body: verdict.body });
  return { ...verdict, findings: [], reply };
}
