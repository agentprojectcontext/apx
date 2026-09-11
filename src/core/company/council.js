// The council's desk.
//
// The layer shipped with one autonomous agent and five advisors who were never
// consulted: the orchestrator was ALLOWED to ask them (one question per run,
// and only if it changed the recommendation), but most runs end in NO_MESSAGE,
// so there was never anything to go deeper on. Five agents that only exist
// while someone is reading their chat are an org chart, not a company.
//
// So the direction is inverted. Each area answers its own question on its own
// cadence and leaves a note here; the orchestrator finds the notes already on
// its desk when it runs, the same way it finds the sources and the ledger. No
// a2a round-trip, no extra turn, and no advisor that can reach the owner.
//
// Notes live in the project's STORAGE, never in the repo: nobody reads them
// before they are written, and the repo is for things a person reviews.
//
// The rubric is ADVISORY here, unlike on a brief. A brief reaches the owner, so
// a malformed one is refused; a note reaches the orchestrator, whose own brief
// is linted anyway — so the guarantee survives either way, and refusing the
// note only throws away the findings that WERE good. The first live run proved
// the point: two real findings (a 401 on the billing source, list prices that
// disagreed across three documents) were discarded because a third bullet had
// no arrow. Worse, a refused note is indistinguishable from a quiet week, so
// the orchestrator was told nobody reported when somebody had.
import fs from "node:fs";
import path from "node:path";

/** A note older than this is not shown: a stale answer is worse than none. */
export const NOTE_MAX_AGE_DAYS = 21;

/** Same rule as artifact names — an area is a name, never a path. */
function assertArea(area) {
  const raw = String(area ?? "").trim().toLowerCase();
  if (!raw) throw new Error("area required");
  if (raw !== path.basename(raw) || raw.startsWith(".") || !/^[a-z0-9][a-z0-9_-]*$/.test(raw)) {
    throw new Error(`invalid area "${area}" — a slug, not a path`);
  }
  return raw;
}

export function councilDir(storagePath) {
  return path.join(storagePath, "company", "council");
}

export function noteFile(storagePath, area) {
  return path.join(councilDir(storagePath), `${assertArea(area)}.md`);
}

/**
 * File one area's note, replacing whatever it said last time.
 *
 * Replacing, not appending: this is a desk, not a ledger. The orchestrator
 * wants what the CFO thinks TODAY, and an accumulating file would grow into
 * the prompt until it crowded out the state it was meant to inform. The
 * decision ledger is where history belongs.
 *
 * @returns {{file:string, empty:boolean}} `empty` when the area had nothing to
 *   say, which clears the note rather than leaving last week's on the desk.
 */
export function writeNote(storagePath, area, { body, at = new Date(), issues = "" } = {}) {
  const slug = assertArea(area);
  const file = noteFile(storagePath, slug);
  const text = String(body ?? "").trim();

  // "Nothing this week" has to REMOVE the note. Leaving the old one is how an
  // orchestrator ends up reporting a problem that was fixed nine days ago.
  if (!text || /^NO_MESSAGE\b/i.test(text)) {
    try { fs.unlinkSync(file); } catch { /* nothing filed yet */ }
    return { file, empty: true };
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const head = issues ? `<!-- ${at.toISOString()} rubric: ${String(issues).replace(/-->/g, "--")} -->`
                      : `<!-- ${at.toISOString()} -->`;
  fs.writeFileSync(file, `${head}\n${text}\n`);
  return { file, empty: false };
}

function parseNote(file, slug) {
  const raw = fs.readFileSync(file, "utf8");
  const stamped = raw.match(/^<!--\s*(\S+)(?:\s+rubric:\s*([^>]*?))?\s*-->\n?/);
  const at = stamped ? new Date(stamped[1]) : fs.statSync(file).mtime;
  return {
    area: slug,
    at: Number.isNaN(at.getTime()) ? fs.statSync(file).mtime : at,
    issues: (stamped?.[2] || "").trim(),
    body: (stamped ? raw.slice(stamped[0].length) : raw).trim(),
  };
}

/** Every note on the desk, newest first, with anything too old left off. */
export function readNotes(storagePath, { now = new Date(), maxAgeDays = NOTE_MAX_AGE_DAYS } = {}) {
  const dir = councilDir(storagePath);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".md") || name.startsWith(".")) continue;
    try {
      const note = parseNote(path.join(dir, name), name.slice(0, -3));
      const ageDays = (now - note.at) / 86_400_000;
      if (ageDays > maxAgeDays) continue;
      out.push({ ...note, ageDays });
    } catch {
      // An unreadable note is one voice missing, not a failed run.
    }
  }
  return out.sort((a, b) => b.at - a.at);
}

function ageLabel(ageDays) {
  if (ageDays < 1) return "today";
  const d = Math.round(ageDays);
  return `${d}d ago`;
}

/**
 * The `<council>` block. Empty is said out loud rather than omitted: an
 * orchestrator that sees nothing must be able to tell "they had nothing to
 * report" from "nobody ran".
 */
export function renderCouncil(notes) {
  if (!notes.length) return "<council>no notes on the desk — nobody reported this period</council>";
  const rows = notes.map((n) => {
    // A note that drifted from the format is still worth reading — but the
    // orchestrator should know it did, because a bullet with no recommendation
    // is usually a finding whose owner had not decided anything yet.
    const rubric = n.issues ? ` rubric="${n.issues.replace(/"/g, "'")}"` : "";
    return `<note area="${n.area}" at="${n.at.toISOString().slice(0, 16)}Z" age="${ageLabel(n.ageDays)}"${rubric}>\n${n.body}\n</note>`;
  });
  return ["<council>", ...rows, "</council>"].join("\n");
}
