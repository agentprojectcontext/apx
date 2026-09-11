// The header prepended to a turn the daemon is picking up after a restart.
//
// Same idea as the routine header (core/routines/header.js): a block built at
// run time and put at the top of the prompt, so the model opens on the facts it
// cannot otherwise see. Here those facts are its own interrupted work.
//
// It has to exist because the conversation history CANNOT carry them. The tool
// calls a cut-off turn made are persisted — appendAgentReplyToConversation
// writes a `role: "tool"` row with args and result — but both replay paths strip
// those rows before the model sees them, deliberately: api/exec.js
// openConversation keeps user/assistant only, and agent/a2a/history.js does the
// same after tool exhaust once ate 84% of a thread's context. So a resumed turn
// is structurally blind to its own first life, and this is what gives it sight.
//
// It is NOT the safety mechanism. What stops the resumed turn re-sending a
// WhatsApp is the seeded side-effect ledger (agent/loop/side-effects.js), which
// answers a repeat with "already done" whether or not the model was paying
// attention. This header is for JUDGEMENT — whether the work is still worth
// finishing, and what to do about the one thing the ledger cannot rule on: a
// tool that was still running when the process died.

/** A tool call as one readable line: `send_whatsapp(to: "+54…", text: "…")`. */
function callLine(call) {
  const args = call?.args && typeof call.args === "object" ? call.args : {};
  const rendered = Object.entries(args)
    .map(([k, v]) => {
      const text = typeof v === "string" ? v : JSON.stringify(v);
      const short = String(text ?? "").replace(/\s+/g, " ").trim();
      // Long enough to recognise the call, short enough that fifty of them do
      // not crowd out the prompt they are supposed to be context for.
      return `${k}: ${short.length > 120 ? `${short.slice(0, 119)}…` : short}`;
    })
    .join(", ");
  return `${call?.tool || "tool"}(${rendered})`;
}

/**
 * Build the resume block, or "" when there is nothing worth saying.
 *
 * @param {object}   rec
 * @param {Array}    [rec.effects]      Calls that COMPLETED: `[{tool, args}]`.
 * @param {Array}    [rec.in_flight]    Calls that had started and never came back.
 * @param {string}   [rec.partial_text] What it had already said.
 * @param {string}   [rec.cut_at]       When the daemon cut it off.
 */
export function buildResumeHeader(rec = {}) {
  const effects = Array.isArray(rec.effects) ? rec.effects.filter((c) => c?.tool) : [];
  const inFlight = Array.isArray(rec.in_flight) ? rec.in_flight.filter((c) => c?.tool) : [];
  const partial = String(rec.partial_text || "").trim();
  if (!effects.length && !inFlight.length && !partial) return "";

  const lines = [
    "[interrupted turn — the daemon restarted while you were working on this, and you are picking it up]",
    ...(rec.cut_at ? [`Cut off at: ${rec.cut_at}`] : []),
    "",
    "This is not a new request. It is the same one, and part of the work is already done.",
  ];

  if (effects.length) {
    lines.push(
      "",
      "ALREADY DONE — these ran and completed. Do not do them again; their effects are real:",
      ...effects.map((c) => `  · ${callLine(c)}`),
      // Said explicitly because a model that does not know this tends to
      // re-issue the call "to be safe", and being refused without explanation
      // reads as a broken tool.
      "(If you call one of these again with the same arguments it will be refused as already done.)",
    );
  }

  if (inFlight.length) {
    lines.push(
      "",
      "UNCERTAIN — these had started and had not come back when the process died.",
      "Nobody knows whether they took effect. CHECK before redoing any of them:",
      ...inFlight.map((c) => `  · ${callLine(c)}`),
    );
  }

  if (partial) {
    lines.push(
      "",
      "YOU HAD ALREADY SAID (the reader can see this — continue from it, do not repeat it):",
      partial,
    );
  }

  lines.push(
    "",
    "Finish the job from here. If what is left is no longer worth doing, or the world",
    "moved while the daemon was down, say so plainly instead of pretending to continue.",
  );
  return lines.join("\n");
}

/** Put the header above the original prompt, separated by a blank line. */
export function prependResumeHeader(prompt, header) {
  if (typeof prompt !== "string" || !header) return prompt;
  return `${header}\n\n[the original request follows]\n\n${prompt}`;
}
