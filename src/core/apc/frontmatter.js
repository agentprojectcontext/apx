// YAML-ish frontmatter — one parser.
//
// Six copies existed, and they did not agree on which keys are legal:
//
//   apc/parser.js        /^([a-zA-Z_-]+):/          dashes, no digits
//   agent/skills/loader  /^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:/  digits and dashes, strips quotes
//   core/sessions        /^([a-zA-Z_]+):/           neither
//   cli/commands/session /^([a-zA-Z_]+):/           neither
//   stores/sessions      /^([a-zA-Z_]+):/           neither
//   stores/conversations /^([a-zA-Z_]+):/           neither
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
// Still deliberately not a YAML library: the frontmatter APX *writes* is flat
// `key: value` and staying strict about that keeps the format predictable for
// the models that also read these files. But APX also *reads* files it did not
// write — every third-party skill dropped into ~/.apx/skills/ — and those come
// from an ecosystem where a multi-line description is written as a block
// scalar:
//
//   description: |
//     Rewrite text that sounds AI-generated while keeping the writer's
//     facts, meaning, and voice.
//
// A flat parser reads that as the literal string "|" and drops the rest. The
// skill then lists and displays fine while the Skill Inspector embeds "|" as
// its description, so it can never be matched — a silent failure with no error
// anywhere, exactly the class of bug this file was created to end. So two
// shapes beyond flat `key: value` are understood on the way IN:
//
//   • block scalars — `key: |` (literal, lines joined with \n) and `key: >`
//     (folded, lines joined with a space, blank line = one \n).
//   • nested maps   — `metadata:` followed by indented `key: value` children,
//     flattened to dotted keys (`metadata.version`).
//
// Flattening rather than nesting is deliberate: every caller (and the web's
// `frontmatter: Record<string, string>`) can keep assuming string values, so
// reading a nested map is purely additive — nothing that worked before sees a
// different shape. The parent key is still reported as "" exactly as it is
// today, so a caller that reads `fm.metadata` is unaffected.
//
// What APX writes is unchanged: `setFrontmatterField` emits flat `key: value`
// and only reaches for a block scalar when the value it is given contains a
// newline — which previously produced a corrupt file.

const KEY_VALUE = /^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/;

// `|`, `>`, and their chomping/indent variants (`|-`, `>+`, `|2`). The
// indicators are accepted but not honoured — see readBlockScalar.
const BLOCK_SCALAR = /^([|>])[+-]?\d*$/;

function unquote(value) {
  const v = value.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

/** Leading-whitespace width. Tabs count as one — indentation only has to be
 *  comparable within a single file, not universally correct. */
function indentOf(line) {
  const m = line.match(/^[ \t]*/);
  return m ? m[0].length : 0;
}

/**
 * How far the entry that starts at `start` reaches: itself plus every
 * following line indented deeper than it. A blank line belongs to the entry
 * only when a deeper-indented line follows it — that keeps a paragraph break
 * inside a block scalar, without swallowing the blank line an author left
 * between two flat fields.
 *
 * @returns {number} exclusive end index; always > start.
 */
function entryExtent(lines, start, end, indent) {
  let last = start;
  for (let i = start + 1; i < end; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;      // tentative — only kept if more follows
    if (indentOf(line) <= indent) break;
    last = i;
  }
  return last + 1;
}

/**
 * Body of a block scalar: the lines in [start, end), stripped of the common
 * indent established by the first non-blank one.
 *
 * Deviates from YAML in two places, both deliberate and both invisible for the
 * frontmatter this parses: chomping indicators are ignored (trailing blank
 * lines are always stripped — a trailing newline on a description would only
 * surprise callers), and an explicit indent indicator (`|2`) is ignored in
 * favour of the observed indent.
 */
function readBlockScalar(lines, start, end, style) {
  const content = [];
  let blockIndent = null;
  for (let i = start; i < end; i++) {
    const line = lines[i];
    if (line.trim() === "") { content.push(""); continue; }
    const ind = indentOf(line);
    if (blockIndent === null) blockIndent = ind;
    content.push(line.slice(Math.min(ind, blockIndent)));
  }
  while (content.length && content[content.length - 1] === "") content.pop();

  if (style === "|") return content.join("\n");

  // Folded: a run of lines becomes one space-joined line, a blank line ends
  // the run and contributes the single newline between them.
  const paragraphs = [];
  let run = [];
  for (const line of content) {
    if (line.trim() === "") {
      if (run.length) { paragraphs.push(run.join(" ")); run = []; }
      continue;
    }
    run.push(line.trim());
  }
  if (run.length) paragraphs.push(run.join(" "));
  return paragraphs.join("\n");
}

/**
 * Parse the lines of one indentation level into `fm`, recursing into nested
 * maps with dotted key prefixes.
 *
 * `levelIndent` is fixed by the caller for the top level (0, so a stray
 * indented line stays skipped exactly as it always was) and observed from the
 * first child for nested levels.
 */
function parseLevel(lines, start, end, prefix, levelIndent, fm) {
  let indent = levelIndent;
  let i = start;
  while (i < end) {
    const line = lines[i];
    if (line.trim() === "") { i++; continue; }
    const ind = indentOf(line);
    if (indent === null) indent = ind;
    if (ind < indent) break;                     // dedent — belongs to an outer level
    if (ind > indent) { i++; continue; }         // deeper than this level and not claimed
    const m = line.slice(ind).match(KEY_VALUE);
    if (!m) { i++; continue; }                   // not `key: value` — skipped, never fatal

    const key = prefix + m[1];
    const rawValue = m[2].trim();
    const stop = entryExtent(lines, i, end, ind);
    const block = rawValue.match(BLOCK_SCALAR);

    if (block) {
      fm[key] = readBlockScalar(lines, i + 1, stop, block[1]);
    } else if (rawValue === "" && stop > i + 1) {
      // A bare `key:` with indented lines under it: a nested map. The parent
      // keeps the "" it has always had; the children arrive as dotted keys.
      fm[key] = "";
      parseLevel(lines, i + 1, stop, `${key}.`, null, fm);
    } else {
      fm[key] = unquote(m[2]);
    }
    i = stop;
  }
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
  const lines = raw.slice(openLen, end).split("\n");
  parseLevel(lines, 0, lines.length, "", 0, fm);

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
 * Render one `key: value` frontmatter entry as the line(s) it occupies.
 * Single-line values are emitted exactly as they always were; a value that
 * contains a newline becomes a literal block scalar, because writing it flat
 * produces a file that no longer parses back to the same value.
 *
 * @returns {string[]} one entry, one line per element.
 */
export function formatFrontmatterEntry(key, value) {
  const text = `${value}`;
  if (!text.includes("\n")) return [`${key}: ${text}`];
  return [`${key}: |`, ...text.split("\n").map((l) => (l ? `  ${l}` : ""))];
}

/**
 * Set or replace one field in place, preserving the rest of the file byte for
 * byte. Returns the text unchanged when there is no frontmatter to edit.
 *
 * Replacing a field that spans several lines (a block scalar, a nested map)
 * replaces the whole entry — otherwise its continuation lines would be left
 * orphaned under the new value.
 */
export function setFrontmatterField(text, field, value) {
  const raw = String(text ?? "");
  if (!raw.startsWith("---\n")) return raw;
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return raw;

  const lines = raw.slice(4, end).split("\n");
  const idx = lines.findIndex((l) => l.match(KEY_VALUE)?.[1] === field);
  const entry = formatFrontmatterEntry(field, value);
  if (idx >= 0) lines.splice(idx, entryExtent(lines, idx, lines.length, indentOf(lines[idx])) - idx, ...entry);
  else lines.push(...entry);

  return `---\n${lines.join("\n")}${raw.slice(end)}`;
}
