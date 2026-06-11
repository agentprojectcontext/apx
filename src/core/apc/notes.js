// Append-only project notes under .apc/notes/YYYY-MM-DD.md. Each note is a
// timestamped markdown block; the file is append-only so no UID management
// is required.
import fs from "node:fs/promises";
import path from "node:path";
import { apcNotesDir } from "./paths.js";

export async function appendProjectNote(projectPath, { title, body }) {
  const notesDir = apcNotesDir(projectPath);
  await fs.mkdir(notesDir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const file = path.join(notesDir, `${today}.md`);
  const ts = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const block = title
    ? `\n## ${title}\n_${ts}_\n\n${body}\n`
    : `\n### ${ts}\n\n${body}\n`;
  await fs.appendFile(file, block, "utf8");
  return file;
}
