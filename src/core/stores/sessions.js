// Session id generator: YYYY-MM-DD-NN, auto-incremented per agent per UTC day.
// Mirrors cli/src/id.js — kept duplicated so the daemon doesn't import from
// the CLI module tree.

import fs from "node:fs";
import path from "node:path";
import { nowIso } from "../util/time.js";

export function agentSessionsDir(storageRoot, agentSlug) {
  return path.join(storageRoot, "agents", agentSlug, "sessions");
}

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

function slugifyTitle(title) {
  return (
    String(title || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "session"
  );
}

/**
 * Create a new dated session file under
 * `<storageRoot>/agents/<agentSlug>/sessions/YYYY-MM-DD-<titleSlug>.md`,
 * with collision suffix (`-2`, `-3`, …) and standard frontmatter.
 * Returns { filename, path, started }.
 */
export function createAgentSessionFile(storageRoot, agentSlug, { title, body = "" }) {
  if (!title) throw new Error("createAgentSessionFile: title required");
  const dir = agentSessionsDir(storageRoot, agentSlug);
  fs.mkdirSync(dir, { recursive: true });
  const titleSlug = slugifyTitle(title);
  const today = new Date().toISOString().slice(0, 10);
  let candidate = path.join(dir, `${today}-${titleSlug}.md`);
  let n = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${today}-${titleSlug}-${n}.md`);
    n++;
  }
  const started = nowIso();
  const content = `---\ntitle: ${title}\nstarted: ${started}\n---\n\n# ${title}\n\n${body}\n`;
  fs.writeFileSync(candidate, content);
  return { filename: path.basename(candidate), path: candidate, started };
}
