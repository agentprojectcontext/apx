// Decisions an agent needs from somebody, as a structured thing on the task.
//
// "NEEDS USER INPUT" inside an audit report was text: no card asked anything,
// no notice went anywhere verifiable, and two pending items (one for the owner,
// one a correction for the PM) read as one. A decision here has a question,
// options, a recommendation, WHO decides, what is blocked and what can go on.
//
//   · owner decides  → the card raises `awaits_owner`, and ONE remote notice is
//                      attempted through the nudge gate; its outcome (sent,
//                      suppressed, failed, no channel) is recorded on the
//                      decision, never assumed.
//   · agent decides  → the thread comment mentions them and they are summoned:
//                      the owner is not asked to do another agent's job.
//   · answered       → linked to THIS decision id and handed back to whoever
//                      asked. The task is not approved, closed or moved.
//
// The notice carries the question and the task title only — no prompt, no
// thread, nothing from a report body — and is never repeated for a decision.
import { addComment, answerDecision, askDecision, getTask, recordDecisionNotice } from "#core/stores/tasks.js";
import { canNudge, recordNudge } from "#core/nudge/index.js";
import { OWNER_ACTOR_ID } from "#core/constants/actors.js";

const QUESTION_PREVIEW = 300;

function questionComment(decision) {
  const who = decision.responsible === OWNER_ACTOR_ID ? "@owner" : `@${decision.responsible}`;
  const lines = [`❓ Decisión pendiente para ${who} (\`${decision.id}\`): ${decision.question}`];
  if (decision.options.length) lines.push(`Opciones: ${decision.options.map((o, i) => `${i + 1}) ${o}`).join(" · ")}`);
  if (decision.recommendation) lines.push(`Recomendación: ${decision.recommendation}`);
  if (decision.blocking) lines.push(`Bloquea: ${decision.blocking}`);
  if (decision.can_continue) lines.push(`Puede seguir: ${decision.can_continue}`);
  return lines.join("\n");
}

/**
 * Notify the owner about one open decision, at most once. Returns the receipt
 * that was recorded: { channel, status, error? }.
 */
export async function notifyOwnerOfDecision({ storagePath, taskId, decision, plugins, config, projectId = null, projectName = null }) {
  const task = getTask(storagePath, taskId);
  const current = task?.decisions?.find((d) => d.id === decision.id);
  if (!current || current.state !== "open" || current.notice) return current?.notice || null;

  const telegram = plugins?.get?.("telegram") || null;
  const record = (r) => { recordDecisionNotice(storagePath, task.id, decision.id, r); return r; };
  if (!telegram) return record({ channel: null, status: "no_channel" });

  const gate = canNudge(
    { kind: "decision_request", project_id: projectId, severity: "normal", unsolicited: true, channel: "telegram" },
    config || {},
  );
  if (!gate.allowed) return record({ channel: "telegram", status: "suppressed", error: gate.reason || null });

  const where = projectName ? ` (${projectName})` : "";
  const text =
    `❓ Hay una decisión esperándote en "${task.title}"${where}:\n` +
    `${String(current.question).slice(0, QUESTION_PREVIEW)}\n\n` +
    `Respondela en la tarea ${task.id}.`;
  try {
    await telegram.send({ text, meta: { nudge_kind: "decision_request" } });
    recordNudge(gate, { preview: text });
    return record({ channel: "telegram", status: "sent" });
  } catch (e) {
    return record({ channel: "telegram", status: "failed", error: e?.message || String(e) });
  }
}

/**
 * Ask. Writes the decision, a readable comment on the thread, and then either
 * summons the responsible agent or notifies the owner.
 *
 * @param {Function} [summon]  (mentions:string[]) => {summoned, skipped} — the
 *                             caller's bound summonFromAgentComment
 */
export async function requestDecision({
  storagePath, taskId, fields, by, plugins = null, config = null, summon = null,
  projectId = null, projectName = null,
}) {
  const out = askDecision(storagePath, taskId, { ...fields, by });
  if (!out) return null;
  const { decision } = out;
  const agentDecides = decision.responsible !== OWNER_ACTOR_ID;
  addComment(storagePath, out.task.id, {
    by,
    text: questionComment(decision),
    mentions: agentDecides ? [decision.responsible] : [],
    meta: { decision_id: decision.id, decision_phase: "asked" },
  });
  let summoned = null;
  let notice = null;
  if (agentDecides) {
    summoned = summon ? summon([decision.responsible]) : null;
  } else {
    notice = await notifyOwnerOfDecision({ storagePath, taskId: out.task.id, decision, plugins, config, projectId, projectName });
  }
  return { task: getTask(storagePath, out.task.id), decision, summoned, notice };
}

/**
 * Answer, and hand the answer back to whoever asked — as a comment naming the
 * decision, so the asker can tell exactly which blocker it resolved.
 *
 * @param {Function} [handBack]  (askedBy:string, author:string) => void — summons
 *                               the asker (owner-authored or agent-authored path)
 */
export function resolveDecision({ storagePath, taskId, decisionId, answer, choice = null, by, handBack = null }) {
  const out = answerDecision(storagePath, taskId, decisionId, { answer, choice, by });
  if (!out) return null;
  const { decision } = out;
  const asker = decision.asked_by && decision.asked_by !== by && decision.asked_by !== OWNER_ACTOR_ID ? decision.asked_by : null;
  addComment(storagePath, out.task.id, {
    by,
    text: `✅ Decisión \`${decision.id}\` — "${decision.question}": ${decision.answer}${asker ? `\n\n@${asker} seguí con esto; la tarea no queda aprobada por esta respuesta.` : ""}`,
    mentions: asker ? [asker] : [],
    meta: { decision_id: decision.id, decision_phase: "answered" },
  });
  if (asker && handBack) handBack(asker, by);
  return { task: getTask(storagePath, out.task.id), decision, handed_back_to: asker };
}
