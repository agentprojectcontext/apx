// Telegram ask_questions integration.
//
// When the super-agent ends a turn with an `ask_questions` tool call, the
// telegram plugin calls into this module instead of sending the bare reply
// text. We render each question as a Telegram message with an inline keyboard
// (one button per option, plus skip/cancel), keep the in-flight state in
// memory keyed by chat_id, and resume by feeding the compiled answers back
// to the super-agent as a synthetic user prompt.
//
// State is intentionally process-local: an ask flow that started before a
// daemon restart simply dies; the user can re-issue the original prompt.

import { performance } from "node:perf_hooks";

const ASK_TTL_MS = 30 * 60_000; // 30 min — abandoned flows GC'd after this

const STORE = new Map(); // chat_id (string) → AskState

// AskState shape:
// {
//   chatId, projectId, authorId,
//   correlationId,         // short id used in callback_data to dedupe restarts
//   questions: AskQuestion[],
//   answers: { picked: Set<number>, text: string, skipped: boolean }[],
//   index: number,
//   messageId: number|null, // last sent question message (for edit/disable)
//   createdAt, lastTouchedAt,
//   resume: (compiled: string) => Promise<void>, // called when flow completes
// }

function emptyAnswer() {
  return { picked: new Set(), text: "", skipped: false };
}

function genCorrelationId() {
  // Time-derived monotonically-ish id, kept short for Telegram's 64-byte
  // callback_data limit. No Date.now() in workflows but we're in normal Node.
  return Math.floor(performance.now() * 1000).toString(36) + Math.floor(Math.random() * 36 ** 4).toString(36);
}

// Normalize whatever shape the model passed (strings or {question,...} objs)
// into the canonical question record. Identical contract to the web side
// (InlineAskPanel.tsx normalizeQuestionClient).
export function normalizeQuestion(q) {
  if (typeof q === "string") {
    return { question: q, options: [], multiSelect: false, allowText: true };
  }
  if (!q || typeof q !== "object") return null;
  const text = typeof q.question === "string" ? q.question : "";
  if (!text) return null;
  const rawOptions = Array.isArray(q.options) ? q.options : [];
  const options = rawOptions
    .map((o) => {
      if (typeof o === "string") return { label: o };
      if (o && typeof o === "object" && typeof o.label === "string") {
        return {
          label: o.label,
          description: typeof o.description === "string" ? o.description : undefined,
        };
      }
      return null;
    })
    .filter(Boolean);
  return {
    question: text,
    header: typeof q.header === "string" ? q.header : undefined,
    options,
    multiSelect: q.multiSelect === true,
    allowText: q.allowText === false ? false : true,
  };
}

// Pull the most recent ask_questions tool call out of a super-agent trace.
// Returns the normalized question list, or null when the turn didn't ask.
export function extractAskQuestionsFromTrace(trace) {
  if (!Array.isArray(trace)) return null;
  for (let i = trace.length - 1; i >= 0; i--) {
    const t = trace[i];
    if (t && t.tool === "ask_questions") {
      const raw = (t.args && Array.isArray(t.args.questions)) ? t.args.questions : [];
      const normalized = raw.map(normalizeQuestion).filter(Boolean);
      return normalized.length > 0 ? normalized : null;
    }
  }
  return null;
}

// Compile collected answers into a single user-message string. Mirrors the
// shape produced by the web InlineAskPanel.compileAnswers so the super-agent
// sees consistent input across surfaces.
export function compileAnswers(state) {
  const lines = [];
  state.questions.forEach((q, i) => {
    const a = state.answers[i] || emptyAnswer();
    if (a.skipped) {
      lines.push(`- ${q.question}\n  → (omitido)`);
      return;
    }
    const parts = [];
    if (q.options && q.options.length > 0) {
      const labels = [...a.picked]
        .sort((x, y) => x - y)
        .map((idx) => q.options[idx]?.label)
        .filter(Boolean);
      if (labels.length > 0) parts.push(labels.join(", "));
    }
    const text = (a.text || "").trim();
    if (text) {
      parts.push(q.options && q.options.length > 0 ? `(Otro: ${text})` : text);
    }
    const answerText = parts.length > 0 ? parts.join(" ") : "(sin respuesta)";
    lines.push(`- ${q.question}\n  → ${answerText}`);
  });
  return lines.join("\n");
}

// Build the Telegram InlineKeyboardMarkup for one question. Single-select:
// pressing an option commits immediately; the keyboard disappears via
// editMessageReplyMarkup. Multi-select: each press toggles a check on the
// label; a "✓ Confirmar" row commits. No options: keyboard has only a Saltar
// row, and the user is expected to reply with text.
export function buildKeyboard(state) {
  const cid = state.correlationId;
  const q = state.questions[state.index];
  const a = state.answers[state.index] || emptyAnswer();
  const rows = [];

  if (Array.isArray(q.options) && q.options.length > 0) {
    q.options.forEach((opt, i) => {
      const picked = a.picked.has(i);
      const label = q.multiSelect
        ? `${picked ? "☑" : "☐"} ${opt.label}`
        : opt.label;
      rows.push([
        { text: label, callback_data: `apx:ask:${cid}:opt:${i}` },
      ]);
    });
    if (q.multiSelect) {
      rows.push([{ text: "✓ Confirmar", callback_data: `apx:ask:${cid}:next` }]);
    }
  }

  // Control row: skip + cancel. Plus a back arrow when we're past Q1.
  const controls = [];
  if (state.index > 0) controls.push({ text: "◀︎ Atrás", callback_data: `apx:ask:${cid}:back` });
  controls.push({ text: "Omitir", callback_data: `apx:ask:${cid}:skip` });
  controls.push({ text: "Cerrar", callback_data: `apx:ask:${cid}:cancel` });
  rows.push(controls);

  return { inline_keyboard: rows };
}

// Plain-text body of the question message: header (N/M) + question + a hint
// for free-text questions.
export function formatQuestionText(state) {
  const q = state.questions[state.index];
  const total = state.questions.length;
  const head = total > 1 ? `[${state.index + 1}/${total}] ` : "";
  const hasOptions = Array.isArray(q.options) && q.options.length > 0;
  const hint = hasOptions
    ? (q.multiSelect
        ? "\n\n_Multi-selección: tocá las opciones que quieras y después Confirmar._"
        : "\n\n_Tocá una opción para responder._")
    : "\n\n_Respondé con un mensaje de texto._";
  return `❓ ${head}${q.question}${hint}`;
}

// ---- Store API ------------------------------------------------------------

export function saveState(chatId, state) {
  STORE.set(String(chatId), { ...state, lastTouchedAt: Date.now() });
}

export function getState(chatId) {
  const s = STORE.get(String(chatId));
  if (!s) return null;
  if (Date.now() - s.lastTouchedAt > ASK_TTL_MS) {
    STORE.delete(String(chatId));
    return null;
  }
  return s;
}

export function clearState(chatId) {
  STORE.delete(String(chatId));
}

export function hasPendingFreeText(chatId) {
  const s = getState(chatId);
  if (!s) return false;
  const q = s.questions[s.index];
  if (!q) return false;
  return !(Array.isArray(q.options) && q.options.length > 0);
}

// Apply a user text reply to the currently-pending free-text question.
// Returns the updated state (caller decides whether to advance) or null if
// there was no pending free-text question.
export function applyTextAnswer(chatId, text) {
  const s = getState(chatId);
  if (!s) return null;
  const q = s.questions[s.index];
  const hasOptions = Array.isArray(q.options) && q.options.length > 0;
  if (hasOptions) return null; // multi/single-select questions are answered via callback only
  const ans = s.answers[s.index] || emptyAnswer();
  ans.text = (text || "").trim();
  ans.skipped = false;
  s.answers[s.index] = ans;
  saveState(chatId, s);
  return s;
}

// Apply a callback_query button press. Returns one of:
//   { action: "advance", state }   — render the next question
//   { action: "redraw",  state }   — same question, refresh the keyboard (toggle)
//   { action: "done",    state, compiled } — last question answered
//   { action: "cancel",  state }   — user closed the panel
//   null — callback wasn't ours
//
// callback_data scheme: apx:ask:<correlationId>:<verb>[:<arg>]
//   verbs: opt:<i>, next, back, skip, cancel
export function applyCallback(chatId, data) {
  const s = getState(chatId);
  if (!s) return null;
  if (typeof data !== "string" || !data.startsWith("apx:ask:")) return null;
  const rest = data.slice("apx:ask:".length); // <corr>:<verb>[:<arg>]
  const [corr, verb, arg] = rest.split(":");
  if (corr !== s.correlationId) {
    // Stale button from a previous flow.
    return null;
  }
  const q = s.questions[s.index];
  const ans = s.answers[s.index] || emptyAnswer();

  if (verb === "opt") {
    const optIdx = Number.parseInt(arg, 10);
    if (!Number.isFinite(optIdx) || optIdx < 0 || optIdx >= (q.options?.length || 0)) {
      return null;
    }
    if (q.multiSelect) {
      // Toggle and stay on the same question.
      if (ans.picked.has(optIdx)) ans.picked.delete(optIdx);
      else ans.picked.add(optIdx);
      ans.skipped = false;
      s.answers[s.index] = ans;
      saveState(chatId, s);
      return { action: "redraw", state: s };
    }
    // Single-select: commit + advance.
    ans.picked = new Set([optIdx]);
    ans.skipped = false;
    s.answers[s.index] = ans;
    return advance(s);
  }

  if (verb === "next") return advance(s);
  if (verb === "back") {
    if (s.index > 0) {
      s.index -= 1;
      saveState(chatId, s);
    }
    return { action: "advance", state: s };
  }
  if (verb === "skip") {
    s.answers[s.index] = { picked: new Set(), text: "", skipped: true };
    return advance(s);
  }
  if (verb === "cancel") {
    clearState(chatId);
    return { action: "cancel", state: s };
  }
  return null;
}

function advance(s) {
  if (s.index >= s.questions.length - 1) {
    const compiled = compileAnswers(s);
    clearState(s.chatId);
    return { action: "done", state: s, compiled };
  }
  s.index += 1;
  saveState(s.chatId, s);
  return { action: "advance", state: s };
}

// Build the initial state and persist it. Caller must follow up with the
// first sendMessage (use formatQuestionText + buildKeyboard).
export function startFlow({ chatId, projectId, authorId, questions, resume }) {
  const state = {
    chatId: String(chatId),
    projectId: projectId != null ? String(projectId) : null,
    authorId: authorId != null ? String(authorId) : null,
    correlationId: genCorrelationId(),
    questions,
    answers: questions.map(() => emptyAnswer()),
    index: 0,
    messageId: null,
    createdAt: Date.now(),
    lastTouchedAt: Date.now(),
    resume,
  };
  saveState(chatId, state);
  return state;
}

// Test-only: clear the global store between unit tests.
export function _reset() {
  STORE.clear();
}
