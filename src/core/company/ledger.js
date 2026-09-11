// The decision ledger — the executive layer's episodic memory.
//
// Each run distils into one entry and the next run opens with a
// `<past_decisions>` block built from it. A markdown file rather than a
// database: it is greppable, diffable, survives the daemon being reinstalled,
// and a person can read it without a client.
//
// Append-only in practice: every run writes an entry, whatever the outcome. A
// dropped brief is as much history as a delivered one — it is the record that
// says the layer ran and found nothing, which is the only thing that tells a
// quiet week apart from a broken routine.
import fs from "node:fs";
import path from "node:path";

const HEADER = `# Executive ledger

Written by \`apx company handoff\` at the end of every ritual: one entry per
run, delivered or not. It is the executive layer's episodic memory — the
\`<past_decisions>\` block that opens the next run is built from it, and what
was already said is deduplicated against it.

Not edited by hand except to fix something that came out wrong. If an entry is
surplus, delete it whole; the parser reads by heading.

An entry looks like this:

    ### <ISO timestamp> · <ritual>
    - action: send | hold | drop | rejected
    - severity: blocker | status | fyi
    - hash: <content fingerprint>
    - sources: board=ok · repos=ok
    - reason: why the guard decided that

    > the brief, exactly as delivered

`;

const KEYS = ["action", "severity", "hash", "sources", "reason"];

export function formatEntry(entry) {
  const at = new Date(entry.at ?? Date.now()).toISOString().replace(/\.\d{3}Z$/, "Z");
  const lines = [`### ${at} · ${entry.ritual}`];
  for (const key of KEYS) {
    const value = entry[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      lines.push(`- ${key}: ${String(value).replace(/\s*\r?\n\s*/g, " ").trim()}`);
    }
  }
  lines.push("");
  for (const line of String(entry.body ?? "").split(/\r?\n/)) lines.push(`> ${line}`.trimEnd());
  lines.push("");
  return lines.join("\n");
}

export function parseLedger(text) {
  const entries = [];
  for (const chunk of String(text ?? "").split(/^### /m).slice(1)) {
    const lines = chunk.split(/\r?\n/);
    const [at, ritual] = lines[0].split("·").map((part) => part.trim());
    const entry = { at, ritual, body: "" };
    const body = [];
    for (const line of lines.slice(1)) {
      const meta = line.match(/^-\s+([a-z_]+):\s*(.*)$/);
      if (meta && KEYS.includes(meta[1])) {
        entry[meta[1]] = meta[2].trim();
        continue;
      }
      if (line.startsWith(">")) body.push(line.replace(/^>\s?/, ""));
    }
    entry.body = body.join("\n").trim();
    entry.summary = summarise(entry.body);
    entries.push(entry);
  }
  return entries;
}

function summarise(body, max = 180) {
  const first = String(body ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*•>\s]+/, "").trim())
    .find((line) => line.length > 0);
  if (!first) return "";
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}

export function readLedger(file) {
  if (!file || !fs.existsSync(file)) return [];
  return parseLedger(fs.readFileSync(file, "utf8"));
}

export function appendEntry(entry, file) {
  const text = formatEntry(entry);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, HEADER, "utf8");
  }
  fs.appendFileSync(file, text, "utf8");
  return text;
}

/**
 * What the agent is told about its own past, at the top of a run.
 *
 * Deliberately short, and deliberately including the OUTCOME: a brief that was
 * dropped as a duplicate is exactly what the model needs in order to know it
 * does not have to say it again.
 */
export function renderPastDecisions(entries, { limit = 8 } = {}) {
  const recent = entries.slice(-limit);
  if (recent.length === 0) {
    return "<past_decisions>\nNo history: this is the first run. What you see today is your baseline.\n</past_decisions>";
  }
  const lines = recent.map((entry) => {
    const day = String(entry.at ?? "").slice(0, 10);
    return `- ${day} · ${entry.ritual ?? "?"} · ${entry.action ?? "?"}: ${entry.summary || summarise(entry.body) || "(no body)"}`;
  });
  return ["<past_decisions>", ...lines, "</past_decisions>"].join("\n");
}
