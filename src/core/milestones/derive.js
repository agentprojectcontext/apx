// The floor under the timeline: steps derived from the turns themselves, with
// no model and nothing declared.
//
// WHY THIS IS NOT A SUMMARISER. The obvious build is to hand a long chat to a
// cheap model and ask what happened. It was rejected three times over: it costs
// a call every time somebody opens the view, it answers differently for two
// people looking at the same chat, and it produces exactly the prose recap the
// whole feature exists to avoid. What a reader wants from forty turns is the
// spine, and the spine is already written down — a person asked for something,
// the agent worked, the agent answered. That is a step, and reading it off the
// transcript is arithmetic.
//
// THE UNIT IS THE REQUEST, not the turn and not the tool call. One user message
// plus the work it caused plus the answer it got is one step. It is the only
// boundary in a conversation that a person recognises without being taught it,
// and it survives a turn that ran twenty-four iterations — which is the case
// this exists for.
//
// THE OUTCOME IS THE POINT. A step is `done`, `failed`, `superseded` or `open`,
// and `open` is the one that earns the feature: a request with no answer after
// it is work that was left half-finished — a daemon restart mid-turn, an engine
// that never came back, a tool that hung. Nothing in the product said so before
// this; the chat simply stopped and the reader had to notice the absence
// themselves.
//
// WHICH IS WHY `superseded` HAD TO EXIST. "No answer after it" is also the shape
// of a person typing twice, and the first reading of real data said so: of 39
// unanswered steps across 372 conversations, 28 were closed by another message
// from the same person and ELEVEN of those were the identical text sent again.
// A rail whose alarm count is mostly "you pressed send twice" is a rail people
// stop reading, which is the exact failure the feature was built to fix. So a
// request that its own sender replaced is not an alarm — it is bookkeeping, and
// it is kept (the step count must still match the chat) without being counted.
//
// A step never reaches `running` here. That one is not in the transcript at all
// — nothing on disk distinguishes "nobody ever answered" from "being answered
// right now" — so it is applied a layer up, by whoever holds the daemon's
// register of live turns (core/milestones/index.js).
//
// A DECLARED milestone (core/stores/milestones.js) is richer and says what the
// agent thought it was doing. This runs whether or not anything was declared,
// so a forgotten `mark_milestone` costs detail and never the whole view.

/** How long a derived title may be before it stops being scannable. */
const TITLE_MAX = 120;

/**
 * Within this of its own start, a replaced request was never waiting on anybody.
 *
 * MEASURED, NOT PICKED. Over every conversation on this machine the gap from an
 * unanswered request to the message that replaced it is bimodal: a cluster at
 * 0-20s (corrections, double sends, a "pará") and a long tail from 45s to four
 * HOURS, and the tail is full of the real thing — "segui" with no answer for 45
 * minutes, a background-job wake-up that sat for 232 until its sender asked
 * "¿terminó?". 30s sits in the empty middle. Erring low is deliberate: calling
 * a hang "superseded" hides the one event this feature exists to show, while
 * calling a correction "open" only costs an amber dot somebody dismisses.
 */
export const SUPERSEDED_WINDOW_MS = 30_000;

/** Roles that carry no work and no request — they are scaffolding. */
const IGNORED_ROLES = new Set(["system", "compact"]);

/**
 * A request, reduced to the line a rail can show.
 *
 * The user's own words, not a paraphrase: "make me a reel for Thursday" is
 * already the best possible label for that step, and anything generated from it
 * is a worse version of it that also costs a model call.
 */
export function stepTitle(content, max = TITLE_MAX) {
  let text = String(content || "");

  // A ROUTINE'S PROMPT OPENS ON A MACHINE HEADER, not on the request. The runner
  // prepends an automation block (core/routines/header.js) carrying the id, the
  // memory path and two clock stamps, and the actual instruction starts after
  // the blank line under it. Titled without this, every scheduled run on the
  // timeline read "Automation ID: r_… Automation memory: /Users/…" — the same
  // opaque line twelve times over, which is worse than no title at all because
  // it fills the rail while naming nothing.
  //
  // Anchored on the literal first field rather than on a general "looks like a
  // key: value block" rule: a real request that happens to open on "Note: …"
  // must keep its own words.
  if (/^Automation ID:/.test(text)) {
    const body = text.split(/\n\s*\n/).slice(1).join("\n\n");
    if (body.trim()) text = body;
  }

  // Attachment markers are prepended to the prompt by the upload path
  // ([archivo: …] / [file: …]); they name plumbing, not the request.
  text = text.replace(/^\s*(?:\[[^\]\n]{0,200}\]\s*)+/, "");
  // Fenced code and inline backticks: a request that opens with a pasted stack
  // trace should be titled by its sentence, not by the paste.
  text = text.replace(/```[\s\S]*?```/g, " ").replace(/`([^`]*)`/g, "$1");
  // Markdown emphasis and heading marks, which read as noise in a one-liner.
  text = text.replace(/^#{1,6}\s+/gm, "").replace(/[*_]{1,3}(?=\S)/g, "");
  text = text.replace(/\s+/g, " ").trim();
  if (!text) return "";

  // The first sentence, when there is a clean one inside the cap. A request is
  // usually one sentence of ask followed by detail, and the ask is the title.
  const sentence = text.split(/(?<=[.!?¿?])\s+/)[0] || text;
  const base = sentence.length >= 8 && sentence.length <= max ? sentence : text;
  if (base.length <= max) return base;
  // Cut on a word boundary when one is near the end, so a title does not end
  // mid-word for the sake of three characters.
  const cut = base.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd() + "…";
}

/**
 * What a `tool` turn ran, and whether it worked.
 *
 * TWO REAL SHAPES, not one plus a hack. A conversation FILE stores the call as
 * JSON in the body (`appendAgentReplyToConversation`); a LEDGER row arrives
 * already shaped, with `tool` and `result` as fields on the turn
 * (`shapeLedgerMessage`). Both are how this repo writes a tool call down, so
 * both are read here rather than normalised at four call sites.
 *
 * Unparseable rows still count as a step's work; they just cannot say which
 * tool or whether it failed, and guessing either would be worse.
 */
function parseToolTurn(turn) {
  const shaped = turn && (typeof turn.tool === "string" || turn.result !== undefined);
  const row = shaped ? turn : safeJson(turn?.content);
  if (!row || typeof row !== "object") return { tool: null, failed: false };
  const result = row.result;
  const failed =
    !!result && typeof result === "object" && (!!result.error || result.suppressed === true);
  return { tool: typeof row.tool === "string" ? row.tool : null, failed };
}

function safeJson(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return null;
  }
}

function emptyStep(turn, index) {
  return {
    kind: "derived",
    index,
    title: stepTitle(turn.content),
    state: "open",
    superseded_reason: null,
    started_at: turn.ts || null,
    ended_at: null,
    answered: false,
    tools: { total: 0, failed: 0, names: [] },
    agent: null,
    model: null,
  };
}

/**
 * An assistant turn's attribution, wherever this shape happens to keep it.
 *
 * A conversation FILE stores it under `meta` on the turn header; a LEDGER row
 * comes back from `shapeLedgerMessage` with the same fields lifted to the top
 * level. Both are how an answered turn is written down here, so both are read —
 * the alternative is a normaliser at every call site, which is where the two
 * quietly stop agreeing.
 */
function attr(turn, key) {
  if (!turn) return undefined;
  return turn[key] !== undefined ? turn[key] : turn.meta?.[key];
}

/**
 * Two requests reduced to the form in which "the same thing again" is decidable.
 *
 * Case-folded and whitespace-flattened, and nothing else: a resend is normally
 * byte-identical, so the only job here is to survive a retype. Anything cleverer
 * (stripping punctuation, stemming) starts merging requests that a person wrote
 * on purpose as two.
 */
function sameRequest(a, b) {
  const norm = (v) => String(v || "").replace(/\s+/g, " ").trim().toLowerCase();
  const left = norm(a);
  return !!left && left === norm(b);
}

/**
 * Why this unanswered request is not an abandonment — or null, when it is one.
 *
 * "repeated": the same text arrived again. Decided on equality and NOT on the
 * clock, because the resends in real data span three seconds to ten minutes —
 * a person who gives up waiting and pastes their question again is still a
 * person who sent one question, however long they waited first.
 *
 * "replaced": something else arrived while nobody could reasonably have
 * answered yet. This one is the clock's.
 *
 * WORK VETOES BOTH. A request that already ran tools spent something, and if no
 * answer followed, that spend was lost — which is worth a reader's attention
 * whatever came next. (No such step exists in the data this was measured on:
 * all 28 had run nothing. The veto costs nothing today and is the difference
 * between a rule that is right and a rule that has been lucky.)
 */
function supersededReason(step, request, next) {
  if (!next || step.answered || step.tools.total > 0) return null;
  if (sameRequest(request, next.content)) return "repeated";
  const from = Date.parse(step.started_at || "");
  const to = Date.parse(next.ts || "");
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return to >= from && to - from <= SUPERSEDED_WINDOW_MS ? "replaced" : null;
}

/**
 * Close a step. `answered` decides between a finished step and an abandoned
 * one; the tool tally decides between finished-well and finished-badly — unless
 * the request was never left waiting at all, which `supersededReason` decides.
 *
 * The assistant row's own `tool_summary` wins when it is there: it was written
 * by the run itself and counts calls the transcript may not carry (a turn whose
 * tool rows were trimmed still knows what it ran).
 */
function closeStep(step, { assistant = null, supersededBy = null, request = "" } = {}) {
  if (assistant) {
    step.answered = true;
    step.ended_at = assistant.ts || step.ended_at;

    const summary = attr(assistant, "tool_summary");
    if (summary && typeof summary === "object") {
      step.tools.total = Number(summary.total) || step.tools.total;
      step.tools.failed = Number(summary.failed) || step.tools.failed;
      if (Array.isArray(summary.tools) && !step.tools.names.length) {
        step.tools.names = summary.tools.map((t) => t?.name).filter(Boolean);
      }
    }

    // An a2a peer's calls have no `tool` rows of their own — they were moved
    // onto the reply's own trace so a transcript could not eat the next turn's
    // context. Counted here, or a peer's whole timeline reads as work-free.
    const trace = attr(assistant, "trace");
    if (!summary && Array.isArray(trace) && trace.length) {
      step.tools.total += trace.length;
      for (const item of trace) {
        const failed =
          !!item?.result && typeof item.result === "object" &&
          (!!item.result.error || item.result.suppressed === true);
        if (failed) step.tools.failed += 1;
        if (item?.tool && !step.tools.names.includes(item.tool)) step.tools.names.push(item.tool);
      }
    }

    // A turn NOBODY ASKED FOR still deserves a name. A routine delivering into
    // an agent's chat, a wake-up, an a2a reply — there is no request in front of
    // it, so the title would be empty and the rail would read "Unnamed step" over
    // a row that has real content in it. Named by what the agent SAID instead,
    // which is the only honest label available: this is what came out.
    if (!step.title) step.title = stepTitle(assistant.content);

    step.agent = attr(assistant, "agent_name") || attr(assistant, "agent") || step.agent;
    step.model = attr(assistant, "model") || step.model;
  }
  const superseded = supersededReason(step, request, supersededBy);
  if (superseded) {
    step.state = "superseded";
    // The reason is carried, not folded into the state, because the two read
    // differently to the person who caused them: "you sent this twice" is a
    // thing to notice, "you changed your mind" is not.
    step.superseded_reason = superseded;
    return step;
  }
  step.state = !step.answered ? "open" : step.tools.failed > 0 ? "failed" : "done";
  return step;
}

/**
 * Turns → steps, oldest first.
 *
 * @param {{role: string, ts?: string, content?: string, meta?: object}[]} turns
 *        as `parseConversation` returns them.
 * @returns {object[]} one step per request, each with a state of
 *        "done" | "failed" | "open".
 */
export function deriveSteps(turns) {
  const steps = [];
  let current = null;
  // The open step's request, in the sender's own bytes. `title` cannot stand in
  // for it: it is truncated at 120 characters and has had headers and code
  // fences taken out of it, so two long requests that differ only past the cut
  // would compare equal and one would be swallowed as a resend.
  let request = "";

  for (const turn of Array.isArray(turns) ? turns : []) {
    if (!turn || IGNORED_ROLES.has(turn.role)) continue;

    if (turn.role === "user") {
      // A second request with no answer between them closes the first — as
      // `open` when it was left waiting, and as `superseded` when this message
      // is what stopped it waiting. Both shapes are "user, user" on disk and
      // only the pair decides which, so the replacing turn goes in with it.
      if (current) steps.push(closeStep(current, { supersededBy: turn, request }));
      current = emptyStep(turn, steps.length);
      request = String(turn.content || "");
      continue;
    }

    // Work or an answer with no request in front of it: an agent-initiated turn
    // (a routine, a wake-up, an a2a reply). It is still a step — it is just a
    // step nobody asked for, and dropping it would hide exactly the runs that
    // nobody watched.
    if (!current) {
      current = emptyStep({ ts: turn.ts, content: "" }, steps.length);
      request = "";
    }

    if (turn.role === "tool") {
      const { tool, failed } = parseToolTurn(turn);
      current.tools.total += 1;
      if (failed) current.tools.failed += 1;
      if (tool && !current.tools.names.includes(tool)) current.tools.names.push(tool);
      continue;
    }

    if (turn.role === "assistant") {
      steps.push(closeStep(current, { assistant: turn }));
      current = null;
      request = "";
    }
  }

  // Nothing follows the last step, so nothing can have superseded it: it is
  // `open` if it was never answered, and whether that means abandoned or still
  // being written is not decidable from the transcript (see the header).
  if (current) steps.push(closeStep(current));
  return steps;
}
