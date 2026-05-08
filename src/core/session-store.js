// Session id generator: YYYY-MM-DD-NN, auto-incremented per agent per UTC day.
// Mirrors cli/src/id.js — kept duplicated so the daemon doesn't import from
// the CLI module tree.

import fs from "node:fs";
import path from "node:path";

export function generateSessionId(storageRoot, agentSlug) {
  const today = new Date().toISOString().slice(0, 10);
  const dir = path.join(storageRoot, "agents", agentSlug, "sessions");
  let next = 1;
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(new RegExp(`^${today}-(\\d{2,})\\.md$`));
      if (m) {
        const n = parseInt(m[1], 10);
        if (n + 1 > next) next = n + 1;
      }
    }
  }
  return `${today}-${String(next).padStart(2, "0")}`;
}

export function readSessionFrontmatter(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, "utf8");
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---", 4);
  if (end === -1) return null;
  const fm = {};
  for (const line of text.slice(4, end).split("\n")) {
    const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (m) fm[m[1]] = m[2].trim();
  }
  return { fm, body: text.slice(end + 4).replace(/^\n+/, "") };
}
