// Text that is about to be spoken aloud, cleaned of what a voice cannot say.
//
// A TTS model has to produce *something* for every token it is given, and an
// emoji has no pronunciation — so it improvises, which comes out as a couple of
// seconds of humming in the middle of a sentence. Roby ending a reply with 👍
// is pleasant to read and unlistenable.
//
// This is deliberately about speech, not about display: a channel that shows
// the text as well decides separately whether the reader keeps the emoji.

// Pictographs, plus the pieces that glue them together: variation selectors,
// zero-width joiners, skin-tone modifiers, keycap marks and the regional
// indicators that spell out flags.
// Written as alternatives rather than one character class on purpose: the
// joiners below are combining marks, and a class that mixes them with the
// pictographs they attach to is both misleading to read and flagged by lint.
const EMOJI = new RegExp(
  [
    "\\p{Extended_Pictographic}",   // the pictographs themselves
    "\\p{Regional_Indicator}",      // the letter pairs that spell out flags
    "[\\u{1F3FB}-\\u{1F3FF}]",     // skin-tone modifiers
    "\\uFE0F",                     // variation selector (the "render as emoji" flag)
    "\\u200D",                     // zero-width joiner, glues 👨‍👩‍👧 together
    "\\u20E3",                     // the enclosing box of a keycap like 1️⃣
  ].join("|"),
  "gu"
);

/**
 * Remove emoji from text meant to be spoken, and tidy the space they leave.
 * Returns "" when nothing sayable is left, which lets a caller drop a segment
 * that was only an emoji instead of synthesizing a shrug.
 */
export function stripEmoji(text) {
  return String(text ?? "")
    .replace(EMOJI, "")
    // An emoji sitting between words leaves a double space; one that trailed a
    // sentence leaves a space before the period.
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.;:!?…])/g, "$1")
    .replace(/^[ \t]+|[ \t]+$/gm, "")
    .trim();
}
