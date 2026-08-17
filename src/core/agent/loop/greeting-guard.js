// Collapse repeated greetings inside a single turn.
//
// A turn can emit several text segments (pre-tool narration, then the final
// answer) and weaker models greet in each one, so the user sees "¡Hola Manu!"
// twice. Keep the first greeting, strip any later one.
//
// Belt-and-suspenders over the action-discipline prompt rule: strong models
// follow that rule, gemini-flash and friends often do not.
//
// Extracted from runAgent, where it was two loose variables and a closure among
// twelve other concerns. As its own object it can be tested directly, which it
// could not be before.
// A leading greeting clause: "¡Hola Manu!", "Hola,", "Hi there!", "Buenas tardes…".
// Intentionally narrow — only the opening salutation up to its first terminator —
// so we never eat real content.
// The comma matters. Without it the class ran to the first sentence
// terminator, so "Hola de nuevo, ya está listo." matched in full and the guard
// deleted the whole sentence — the opposite of the "never eat real content"
// intent stated above. Stopping at a comma keeps the vocative ("¡Hola Manu!",
// "Hola de nuevo,") and leaves the sentence that follows.
//
// Known limit: a greeting glued to content with no separator at all
// ("Hey arranco.") is genuinely ambiguous and is still consumed. That is the
// rarer shape, and erring toward stripping there matches the original intent.
export const LEADING_GREETING_RE =
  /^\s*[¡!]*\s*(hola+|holis?|buenas|buen[oa]s?\s+(d[ií]as|tardes|noches)|hey|hi|hello)\b[^,.!?¡\n]*[,.!?¡]*[\s]*/i;

/** If `text` opens with a greeting, return it with that greeting removed; else null. */
export function stripLeadingGreeting(text) {
  const m = String(text).match(LEADING_GREETING_RE);
  if (!m) return null;
  return String(text).slice(m[0].length).replace(/^\s+/, "");
}

/**
 * @returns {{ apply(text: string): string, greeted: boolean }} `apply` returns
 *   the text to show the user; call it once per emitted segment, in order.
 */
export function createGreetingGuard() {
  let greeted = false;
  return {
    apply(text) {
      if (!text) return text;
      if (greeted) {
        const stripped = stripLeadingGreeting(text);
        return stripped == null ? text : stripped;
      }
      if (LEADING_GREETING_RE.test(text)) greeted = true;
      return text;
    },
    get greeted() {
      return greeted;
    },
  };
}
