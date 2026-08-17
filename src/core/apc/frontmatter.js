// YAML-ish frontmatter — one parser.
//
// Four copies existed, and they did not agree on which keys are legal:
//
//   apc/parser.js        /^([a-zA-Z_-]+):/          dashes, no digits
//   agent/skills/loader  /^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:/  digits and dashes, strips quotes
//   core/sessions        /^([a-zA-Z_]+):/           neither
//   cli/commands/session /^([a-zA-Z_]+):/           neither
//
// That is not cosmetic duplication: a key like `route_to_agent2` or
// `agent-slug` parsed in some code paths and vanished in others, so the same
// file read by the CLI and by the daemon yielded different data — with no
// error anywhere, because a non-matching line is simply skipped.
//
// This takes the most permissive correct behaviour (identifiers may contain
// digits and dashes, quoted values are unquoted) and returns everything the
// callers between them needed: the fields, the body, and where the body starts.
//
// Deliberately not a YAML library: the frontmatter APX writes is flat
// `key: value` and staying strict about that keeps the format predictable for
// the models that also read these files.

const KEY_VALUE = /^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/;

function unquote(value) {
  const v = value.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * Parse leading `---` frontmatter.
 *
 * @param {string} text
 * @returns {{ fm: Record<string,string>, body: string, bodyStart: number }}
 *   `fm` is `{}` when there is no frontmatter; `body` is then the whole text
 *   and `bodyStart` is 0.
 */
export function parseFrontmatter(text) {
  const raw = String(text ?? "");
  // Accept both "---\n" and a bare leading "---" (the skills loader allowed
  // the latter; session files always write the former).
  if (!raw.startsWith("---")) return { fm: {}, body: raw, bodyStart: 0 };

  const openLen = raw.startsWith("---\n") ? 4 : 3;
  const end = raw.indexOf("\n---", openLen - 1);
  if (end === -1) return { fm: {}, body: raw, bodyStart: 0 };

  const fm = {};
  for (const line of raw.slice(openLen, end).split("\n")) {
    const m = line.match(KEY_VALUE);
    if (m) fm[m[1]] = unquote(m[2]);
  }

  // The closing fence is followed by a newline, and authors conventionally
  // leave a blank line after it — consume both so `body` starts at content.
  const bodyStart = end + 4;
  return { fm, body: raw.slice(bodyStart).replace(/^\n+/, ""), bodyStart };
}

/** Just the fields, for callers that don't need the body. */
export function parseFrontmatterFields(text) {
  return parseFrontmatter(text).fm;
}

/**
 * Set or replace one field in place, preserving the rest of the file byte for
 * byte. Returns the text unchanged when there is no frontmatter to edit.
 */
export function setFrontmatterField(text, field, value) {
  const raw = String(text ?? "");
  if (!raw.startsWith("---\n")) return raw;
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return raw;

  const lines = raw.slice(4, end).split("\n");
  const idx = lines.findIndex((l) => l.match(KEY_VALUE)?.[1] === field);
  const entry = `${field}: ${value}`;
  if (idx >= 0) lines[idx] = entry;
  else lines.push(entry);

  return `---\n${lines.join("\n")}${raw.slice(end)}`;
}
