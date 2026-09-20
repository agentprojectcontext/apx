// A turn that got stuck on a character, cut down to the size of a message.
//
// WHAT HAPPENED. On 2026-09-20 a reply ended a normal paragraph with one 😅 and
// then wrote that emoji several thousand times. The turn was correct up to that
// point; the tail was degeneration — the failure mode where a sampler falls into
// a fixed point and stops leaving it. Three things broke at once, and none of
// them looked like the same bug:
//
//   - Telegram refused the send (its 4096-char limit), so the answer the owner
//     was waiting for never arrived on the channel he was reading;
//   - the web transcript FROZE. Not slow — frozen: a colour-font glyph is an
//     image, and asking a browser to lay out tens of thousands of them stops
//     the tab. "No se ve el chat mejor dicho el thread" (Manu, 2026-09-20);
//   - the row went to the ledger at full length, so the next turn's history
//     carried it too, and re-opening the thread froze again.
//
// `stuck-detector.js` is the same idea one level up — it watches the TOOL loop
// repeat itself. This watches the prose, which that detector cannot see: a turn
// that calls no tools and writes one emoji forever is, to the loop, a turn that
// answered.
//
// WHAT IT IS NOT. Not a filter on emoji, or on repetition people actually mean
// — "jajajaja", a row of ✅ next to six finished items, an ASCII rule. The
// thresholds are set well above anything written on purpose, the run is kept
// (clipped, not deleted) and the count is stated, so nothing is silently
// rewritten: the reader sees what the model did.

/** Repeats of one unit before a run stops being something anyone typed. */
export const MAX_RUN = 40;

/** The longest repeating unit looked for: enough for "ja ", "😂🤣", "- ", "=-=". */
export const MAX_CYCLE = 8;

/** Runs shorter than this are left completely alone, whatever they repeat —
 *  cheap early exit for the overwhelming majority of turns. */
const MIN_INTERESTING = MAX_RUN * 2;

function unitEquals(cp, a, b, len) {
  for (let k = 0; k < len; k += 1) if (cp[a + k] !== cp[b + k]) return false;
  return true;
}

/**
 * Clip runaway repetition out of a model's text.
 *
 * @param {string} text
 * @param {object} [o]
 * @param {number} [o.maxRun]    repeats kept before the run is clipped
 * @param {number} [o.maxCycle]  longest repeating unit detected
 * @returns {string} the text, with any runaway run clipped and counted
 */
export function clampRunawayText(text, { maxRun = MAX_RUN, maxCycle = MAX_CYCLE } = {}) {
  const raw = typeof text === "string" ? text : "";
  if (raw.length < MIN_INTERESTING) return raw;

  // By CODE POINT, not by UTF-16 unit: an emoji is a surrogate pair, and
  // counting halves would cut one in two and hand the surface a lone surrogate
  // — a different rendering bug in place of this one.
  const cp = Array.from(raw);
  if (cp.length < MIN_INTERESTING) return raw;

  const out = [];
  let i = 0;
  let clipped = false;

  while (i < cp.length) {
    let jumped = false;
    for (let len = 1; len <= maxCycle && i + len * 2 <= cp.length; len += 1) {
      // Cheap gate first: unless the unit repeats even once, there is no run to
      // count, and this is what keeps ordinary prose at one comparison per
      // character per cycle length instead of a full scan.
      if (!unitEquals(cp, i, i + len, len)) continue;
      let reps = 2;
      while (i + (reps + 1) * len <= cp.length && unitEquals(cp, i, i + reps * len, len)) {
        reps += 1;
        // Nothing past the threshold changes the decision, only the number, and
        // the number is recomputed from the jump below.
        if (reps > cp.length) break;
      }
      if (reps < maxRun) continue;
      // Keep the first `maxRun` — a clipped run still reads as a run — then say
      // how many more there were. The count is the evidence: without it this is
      // indistinguishable from a model that simply stopped.
      for (let r = 0; r < maxRun; r += 1) out.push(...cp.slice(i, i + len));
      out.push(...Array.from(` …[×${reps}]`));
      i += reps * len;
      clipped = true;
      jumped = true;
      break;
    }
    if (jumped) continue;
    out.push(cp[i]);
    i += 1;
  }

  return clipped ? out.join("") : raw;
}
