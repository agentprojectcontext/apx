// The shape every dated note file in APX shares: one `## YYYY-MM-DD` heading
// per day, one `- [HH:MM][channel] note` bullet per note, oldest day first.
//
// Three files are written this way — the super-agent's notebook
// (`~/.apx/memory.md`), a project's memory (`<repo>/.apc/memory.md`) and a
// routine's memory — and the fiddly part is the same in all three: a note
// written today belongs at the END of TODAY'S block, not at the end of the
// file. Get that wrong and the day splits into two headings the moment
// anything else is appended. It had been written correctly once and
// approximately twice more; this is the one copy.
//
// Pure — the caller owns the file I/O.
import { dayStamp, hourStamp } from "#core/util/time.js";

/**
 * Append one note to a dated markdown log and return the new body.
 *
 * @param existing  current file body ("" for a file that doesn't exist yet)
 * @param note      the note; newlines are flattened, one bullet per call
 * @param opts.channel  tags the bullet "[HH:MM][channel] …" so the broker and
 *                      the RAG indexer can attribute it. Omitted → plain "- note".
 * @param opts.time     override the HH:MM tag (tests, backfills)
 * @param opts.date     override the day heading (tests, backfills)
 * @param opts.header   "# …" title used only when creating the file
 */
export function appendDatedBullet(existing, note, opts = {}) {
  const text = String(note || "").trim();
  if (!text) throw new Error("nothing to remember (empty note)");

  const { channel = "", time = "", header = "" } = opts;
  const date = opts.date || dayStamp();
  const heading = `## ${date}`;
  const oneLine = text.replace(/\n+/g, " ").trim();
  const ch = String(channel || "").trim().toLowerCase();
  const bullet = `- ${ch ? `[${time || hourStamp()}][${ch}] ` : ""}${oneLine}`;

  const body = String(existing || "");
  if (!body.trim()) {
    return header ? `${header}\n\n${heading}\n${bullet}\n` : `${heading}\n${bullet}\n`;
  }

  const lines = body.split("\n");
  // lastIndexOf, not includes(): a heading that merely *contains* today's date
  // ("## 2026-01-01 — release") is not today's block, and treating it as one
  // used to splice the bullet under whatever heading happened to come first.
  const idx = lines.lastIndexOf(heading);
  if (idx < 0) {
    const sep = body.endsWith("\n") ? "" : "\n";
    return `${body}${sep}\n${heading}\n${bullet}\n`;
  }

  // End of today's block: the next heading, or EOF. Trailing blank lines inside
  // the block stay below the new bullet.
  let insertAt = lines.length;
  for (let i = idx + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      insertAt = i;
      break;
    }
  }
  while (insertAt > idx + 1 && lines[insertAt - 1].trim() === "") insertAt--;

  lines.splice(insertAt, 0, bullet);
  const next = lines.join("\n");
  return next.endsWith("\n") ? next : `${next}\n`;
}

// ---------------------------------------------------------------------------
// The durable core: a `## Core` section above the dated log.
//
// The dated log only grows, and a prompt can carry only its newest end — so a
// standing rule written on day one ("posts are scheduled, never published on
// the spot") fell out of every prompt within a week while "the render finished"
// from this morning stayed in. Hermes and OpenClaw split memory the same way:
// a small curated core that ships every turn, and a log left to retrieval.
// ---------------------------------------------------------------------------

const CORE_HEADING = "## Core";
export { CORE_HEADING };
// Enough for the rules and preferences that matter; small enough to ship every
// turn. Past it, adding a fact means replacing or merging one (the tool says so).
export const CORE_MAX_FACTS = 40;

const normFact = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Bounds of the core section in `lines`: { start, end } (end exclusive) or null. */
function coreBounds(lines) {
  const start = lines.findIndex((l) => l.trim() === CORE_HEADING);
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) { end = i; break; }
  }
  return { start, end };
}

/** The core facts of a memory file, in order. */
export function readCoreFacts(body) {
  const lines = String(body || "").split("\n");
  const b = coreBounds(lines);
  if (!b) return [];
  return lines.slice(b.start + 1, b.end)
    .map((l) => l.match(/^[-*]\s+(.*)$/)?.[1]?.trim())
    .filter(Boolean);
}

/**
 * Add a fact to the core (creating the section under the title) and return
 * { body, added, duplicate, replaced, full }. `replaces` names an existing fact
 * (exact or normalised text) the new one supersedes. Pure.
 */
export function upsertCoreFact(existing, fact, { replaces = "", header = "", max = CORE_MAX_FACTS } = {}) {
  const text = String(fact || "").replace(/\n+/g, " ").trim();
  if (!text) throw new Error("nothing to remember (empty fact)");
  let body = String(existing || "");
  if (!body.trim()) body = header ? `${header}\n` : "";
  const lines = body.split("\n");
  let b = coreBounds(lines);
  if (!b) {
    // Right under the "# title" line when there is one, else at the top.
    if (lines[0]?.startsWith("# ")) {
      lines.splice(1, 0, "", CORE_HEADING);
      if (lines.length === 3) lines.push("");
    } else {
      lines.splice(0, 0, CORE_HEADING, "");
    }
    b = coreBounds(lines);
  }
  const facts = lines.slice(b.start + 1, b.end).map((l, i) => ({ i: b.start + 1 + i, text: l.match(/^[-*]\s+(.*)$/)?.[1]?.trim() }))
    .filter((f) => f.text);
  if (facts.some((f) => normFact(f.text) === normFact(text))) {
    return { body: lines.join("\n"), added: false, duplicate: true };
  }
  const target = replaces ? facts.find((f) => normFact(f.text) === normFact(replaces) || f.text === replaces) : null;
  if (replaces && !target) return { body: lines.join("\n"), added: false, notFound: true };
  if (target) {
    lines[target.i] = `- ${text}`;
    return { body: joinLines(lines), added: true, replaced: target.text };
  }
  if (facts.length >= max) return { body: lines.join("\n"), added: false, full: true, facts: facts.map((f) => f.text) };
  // After the last fact, before the section's trailing blank line.
  const insertAt = facts.length ? facts[facts.length - 1].i + 1 : b.start + 1;
  lines.splice(insertAt, 0, `- ${text}`);
  if (!facts.length && lines[insertAt + 1] !== undefined && lines[insertAt + 1] !== "") lines.splice(insertAt + 1, 0, "");
  return { body: joinLines(lines), added: true };
}

function joinLines(lines) {
  const s = lines.join("\n");
  return s.endsWith("\n") ? s : `${s}\n`;
}
