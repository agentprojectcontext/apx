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
