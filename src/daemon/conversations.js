// Conversation storage: append-only markdown at ~/.apx/projects/<id>/agents/<slug>/conversations/
// Filesystem is source of truth. storagePath = ~/.apx/projects/<apx_id>

import fs from "node:fs";
import path from "node:path";

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

export function generateConversationId(storagePath, agentSlug) {
  const today = new Date().toISOString().slice(0, 10);
  const dir = path.join(storagePath, "agents", agentSlug, "conversations");
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

export function conversationPath(storagePath, agentSlug, idOrFilename) {
  const filename = idOrFilename.endsWith(".md") ? idOrFilename : `${idOrFilename}.md`;
  return path.join(storagePath, "agents", agentSlug, "conversations", filename);
}

export function startConversation({ storagePath, agentSlug, engine, system }) {
  const dir = path.join(storagePath, "agents", agentSlug, "conversations");
  fs.mkdirSync(dir, { recursive: true });
  const id = generateConversationId(storagePath, agentSlug);
  const file = path.join(dir, `${id}.md`);
  const started = nowIso();
  const fm =
    `---\n` +
    `id: ${id}\n` +
    `agent: ${agentSlug}\n` +
    `engine: ${engine}\n` +
    `started: ${started}\n` +
    `last_turn: \n` +
    `status: open\n` +
    `---\n\n` +
    (system ? `## system — ${started}\n${system}\n\n` : "");
  fs.writeFileSync(file, fm);
  return { id, filename: `${id}.md`, path: file, started };
}

export function appendTurn({ filePath, role, content }) {
  const ts = nowIso();
  const block = `## ${role} — ${ts}\n${content}\n\n`;
  fs.appendFileSync(filePath, block);
  // Update last_turn in frontmatter (in-place)
  let text = fs.readFileSync(filePath, "utf8");
  text = text.replace(/^last_turn:.*$/m, `last_turn: ${ts}`);
  fs.writeFileSync(filePath, text);
  return { ts };
}

// Parse a conversation file into structured turns. Tolerant — anything that
// doesn't look like a turn header is ignored.
export function parseConversation(text) {
  const fmEnd = text.indexOf("\n---", 4);
  const fm = {};
  let body = text;
  if (text.startsWith("---\n") && fmEnd !== -1) {
    for (const line of text.slice(4, fmEnd).split("\n")) {
      const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
      if (m) fm[m[1]] = m[2].trim();
    }
    body = text.slice(fmEnd + 4);
  }
  const turns = [];
  const re = /^##\s+(user|assistant|system|tool|compact)\s+—\s+(\S+)\s*\n([\s\S]*?)(?=\n##\s+(?:user|assistant|system|tool|compact)\s+—\s|\n*$)/gm;
  let m;
  while ((m = re.exec(body)) !== null) {
    turns.push({
      role: m[1],
      ts: m[2],
      content: m[3].trim(),
    });
  }
  return { fm, turns };
}

export function readConversation(storagePath, agentSlug, idOrFilename) {
  const p = conversationPath(storagePath, agentSlug, idOrFilename);
  if (!fs.existsSync(p)) return null;
  return { ...parseConversation(fs.readFileSync(p, "utf8")), path: p };
}

export function listConversations(storagePath, agentSlug) {
  const dir = path.join(storagePath, "agents", agentSlug, "conversations");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .reverse()
    .map((f) => ({ filename: f, id: f.replace(/\.md$/, "") }));
}

export function setStatus(filePath, status) {
  let text = fs.readFileSync(filePath, "utf8");
  text = text.replace(/^status:.*$/m, `status: ${status}`);
  fs.writeFileSync(filePath, text);
}
