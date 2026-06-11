// Parse the trailing ```suggestions JSON``` block out of an agent reply.
// Surfaces like the deck/desktop render the JSON as chips; the visible reply
// should be stripped of the fenced block so the user (and TTS) never sees it.
//
// Pure: just regex + JSON.parse. Malformed JSON drops suggestions silently
// rather than failing the turn — better UX to show the reply without chips
// than an error.
const SUGGESTIONS_BLOCK_RE = /\n*```\s*suggestions\s*\n([\s\S]*?)\n?```\s*$/i;

const MAX_SUGGESTIONS = 4;
const MAX_LABEL_LEN = 48;
const MAX_COMMAND_LEN = 96;

export function extractSuggestions(text) {
  if (typeof text !== "string" || !text) {
    return { cleanText: text || "", suggestions: [] };
  }
  const m = SUGGESTIONS_BLOCK_RE.exec(text);
  if (!m) return { cleanText: text, suggestions: [] };
  const cleanText = text.slice(0, m.index).trim();
  let suggestions = [];
  try {
    const parsed = JSON.parse(m[1]);
    if (Array.isArray(parsed)) {
      suggestions = parsed
        .filter((s) => s && typeof s === "object" && typeof s.label === "string")
        .slice(0, MAX_SUGGESTIONS)
        .map((s) => ({
          label: String(s.label).slice(0, MAX_LABEL_LEN),
          ...(typeof s.command === "string" ? { command: s.command.slice(0, MAX_COMMAND_LEN) } : {}),
        }));
    }
  } catch {
    // Malformed JSON — drop silently.
  }
  return { cleanText, suggestions };
}
