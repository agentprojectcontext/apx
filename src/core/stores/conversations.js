// Conversation storage: append-only markdown at ~/.apx/projects/<id>/agents/<slug>/conversations/
// Filesystem is source of truth. storagePath = ~/.apx/projects/<apx_id>

import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "#core/apc/frontmatter.js";
import { emitMessageEvent } from "#core/events/bus.js";

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

/** Read a conversation file path back into what it addresses. The inverse of
 *  `conversationPath`, and it lives next to it so the two cannot drift: the
 *  live event feed has a file path and needs the project/agent/conversation it
 *  belongs to. Returns null for anything that is not a conversation file. */
export function parseConversationPath(filePath) {
  const parts = String(filePath || "").split(path.sep);
  const i = parts.lastIndexOf("conversations");
  if (i < 2 || parts[i - 2] !== "agents") return null;
  return {
    project_root: parts.slice(0, i - 2).join(path.sep),
    agent_slug: parts[i - 1],
    conversation_id: (parts[i + 1] || "").replace(/\.md$/, ""),
  };
}

export function startConversation({ storagePath, agentSlug, engine, system, channel, title }) {
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
    (channel ? `channel: ${channel}\n` : "") +
    (title ? `title: ${JSON.stringify(String(title))}\n` : "") +
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
  // Announce it, the same way a ledger write does: a routine or an `apx exec`
  // appending here is a conversation moving, and an open panel should see it
  // without being reloaded. See core/events/bus.js.
  const where = parseConversationPath(filePath);
  if (where) emitMessageEvent({ scope: "conversation", ...where, role, ts });
  return { ts };
}

// Parse a conversation file into structured turns. Tolerant — anything that
// doesn't look like a turn header is ignored.
export function parseConversation(text) {
  const { fm, body } = parseFrontmatter(text);
  const turns = [];
  // The terminator is "the next turn header, or the true end of input".
  //
  // It used to be `\n*$`, and with the /m flag `$` matches the end of any LINE
  // — so the lazy body stopped at the first newline and every multi-line turn
  // was silently truncated to its first line. `(?![\s\S])` is end-of-input and
  // nothing else. /m is still needed for the `^` on the header.
  const re = /^##\s+(user|assistant|system|tool|compact)\s+—\s+(\S+)\s*\n([\s\S]*?)(?=\n##\s+(?:user|assistant|system|tool|compact)\s+—\s|\s*(?![\s\S]))/gm;
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

/** Shape a parsed turn for the web chat viewer (tool rows carry structured args). */
export function shapeConversationMessage(t) {
  const base = { role: t.role, content: t.content, ts: t.ts };
  if (t.role !== "tool") return base;
  let parsed = null;
  try { parsed = JSON.parse(t.content); } catch { parsed = null; }
  if (parsed && typeof parsed === "object" && parsed.tool) {
    return {
      ...base,
      tool: parsed.tool,
      args: parsed.args,
      result: parsed.result,
    };
  }
  return { ...base, tool: "tool" };
}

// Delete a conversation file. Filesystem is source of truth, so unlinking the
// markdown removes it from the sidebar list on the next fetch. Returns false
// when there is nothing to delete (already gone / bad id).
export function deleteConversation(storagePath, agentSlug, idOrFilename) {
  const p = conversationPath(storagePath, agentSlug, idOrFilename);
  if (!fs.existsSync(p)) return false;
  fs.unlinkSync(p);
  return true;
}

export function listConversations(storagePath, agentSlug) {
  const dir = path.join(storagePath, "agents", agentSlug, "conversations");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .reverse()
    .map((f) => summarizeConversation(path.join(dir, f), agentSlug, f))
    .filter(Boolean);
}

// Lightweight summary used by the chat list sidebar — reads frontmatter and
// counts turns without loading the whole conversation into memory beyond what
// `fs.readFileSync` already does. The fields match `ConversationListEntry` on
// the frontend so the sidebar can group + filter without a second roundtrip.
function summarizeConversation(filePath, agentSlug, filename) {
  let text;
  try { text = fs.readFileSync(filePath, "utf8"); } catch { return null; }
  const { fm, turns } = parseConversation(text);
  const messages = turns.filter((t) => t.role === "user" || t.role === "assistant").length;
  const firstUser = turns.find((t) => t.role === "user");
  const title =
    (typeof fm.title === "string" && fm.title.trim()) ||
    (firstUser?.content || "").split("\n")[0].slice(0, 80).trim() ||
    undefined;

  // What the AGENT last said, not what the user last asked. An inbox row that
  // echoes your own prompt back tells you nothing; the reply is the thing you
  // want to see without opening the thread ("report filed, nothing over policy").
  const lastReply = [...turns].reverse().find((t) => t.role === "assistant");
  const preview = (lastReply?.content || "")
    .replace(/```[\s\S]*?```/g, " ")   // code fences read as noise at one line
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160) || undefined;

  return {
    id: filename.replace(/\.md$/, ""),
    filename,
    agent_slug: agentSlug,
    started_at: fm.started || fm.last_turn || "",
    last_turn_at: fm.last_turn || fm.started || "",
    ended_at: fm.status === "closed" ? (fm.last_turn || undefined) : undefined,
    channel: fm.channel || undefined,
    messages,
    title,
    preview,
    preview_at: lastReply?.ts || undefined,
  };
}

export function setStatus(filePath, status) {
  let text = fs.readFileSync(filePath, "utf8");
  text = text.replace(/^status:.*$/m, `status: ${status}`);
  fs.writeFileSync(filePath, text);
}
