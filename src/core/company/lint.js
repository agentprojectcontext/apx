// The rubric, as code.
//
// For an agent whose output IS judgement, testing the code is not testing the
// agent. What can be checked without a model is the FORMAT contract — short,
// every line names a scope, every line ends in a recommendation, nothing is a
// placeholder, and nothing tries to reach the owner directly. Taste stays with
// the model.
//
// The consequence of failing is real: `handoff` refuses to deliver a brief
// that does not lint, so a malformed run reaches the ledger and not the owner.
import { DEFAULT_POLICY, ritualOrThrow } from "./policy.js";

const BULLET = /^\s*[-*•]\s+/;
const SCOPE = /\[[^\]\n]+\]/;
const RECOMMENDATION = /(→|->|recomiend|recomendaci|propongo|sugiero|decidir|decisión|recommend|propose|suggest|decide)/i;
// Case-sensitive on purpose: "todo" is an ordinary Spanish word, and a brief
// that says "todo con movimiento" is not a brief with a placeholder in it.
const PLACEHOLDER = /(\bTODO\b|\bTBD\b|\bFIXME\b|\bXXX\b|lorem ipsum|<[a-z_]{3,}>)/;
const SELF_DELIVERY = /(apx\s+telegram\s+send|telegram_send|send_telegram|t\.me\/)/i;

/**
 * @param {string} brief  the body, severity line already stripped
 * @returns {{ok: boolean, findings: Array<{rule:string, line:number|null, message:string}>}}
 */
export function lint(brief, { ritual = "weekly", maxChars = DEFAULT_POLICY.maxBriefChars } = {}) {
  const definition = ritualOrThrow(ritual);
  const findings = [];
  const add = (rule, message, line = null) => findings.push({ rule, line, message });
  const text = String(brief ?? "").trim();

  if (!text) {
    add("empty", "The brief is empty.");
    return { ok: false, findings };
  }
  if (SELF_DELIVERY.test(text)) {
    add("no-self-delivery", "The brief tries to reach the owner on its own: delivery is the orchestrator's.");
  }
  if (PLACEHOLDER.test(text)) {
    add("no-placeholder", "There is an unresolved placeholder (TODO/TBD/<something>): a brief is delivered finished.");
  }
  if (text.length > maxChars) {
    add("max-chars", `The brief is ${text.length} characters; the cap is ${maxChars}.`);
  }

  // NO_MESSAGE is a valid, complete answer — WITH a reason. Without one it is
  // indistinguishable from a run that failed silently.
  if (/^NO_MESSAGE\b/i.test(text)) {
    const reason = text.replace(/^NO_MESSAGE\b[\s:—-]*/i, "").trim();
    if (reason.length < 10) add("no-message-reason", "NO_MESSAGE with no reason: say why there is nothing to report.");
    return { ok: findings.length === 0, findings };
  }

  const lines = text.split(/\r?\n/);
  const content = lines.filter((line) => line.trim() !== "");
  if (content.length > definition.maxLines) {
    add("max-lines", `${content.length} lines of content; the ${ritual} ritual allows ${definition.maxLines}.`);
  }

  const bullets = lines
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => BULLET.test(line));

  if (bullets.length === 0) {
    add("bullets-required", "No finding in bullets: the format is `- [scope] finding → recommendation`.");
  }
  for (const { line, number } of bullets) {
    if (!SCOPE.test(line)) add("bullet-scope", "The bullet does not name its scope in brackets, e.g. `[niche-agro]`.", number);
    if (!RECOMMENDATION.test(line)) add("bullet-recommendation", "The bullet describes without recommending: the `→ what to do` is missing.", number);
  }
  return { ok: findings.length === 0, findings };
}

/** One line per finding, for stderr and for the ledger. */
export function formatFindings(findings) {
  return findings.map(({ rule, line, message }) => `${rule}${line ? ` (line ${line})` : ""}: ${message}`).join(" · ");
}
