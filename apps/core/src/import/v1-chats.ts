// v1's conversations and Default's agents, brought into v2. The super-agent's chats come as one conversation per
// channel (and per Telegram chat), a contact's WhatsApp chat as one conversation with them; project agents' chats from
// their conversation files. Tool calls ride on the answer that followed them; the model gets the newest stretch (a long
// one is summarized on its next turn). Routine logs, compactions and media stay in v1. Read-only on v1's folder; what
// was brought once is not brought again.
import fs from "node:fs";
import path from "node:path";
import type { Author, Part } from "@apx/protocol";
import { parseFrontmatter } from "../apc/frontmatter.ts";
import { readAgentDir } from "../apc/read.ts";
import type { Store } from "../domain/store.ts";

/** The super-agent's channels worth keeping as chats (routine deliveries, code and decks are not conversations). */
const CHANNELS = ["telegram", "web", "whatsapp", "cli", "desktop", "api", "web_sidebar", "discord"] as const;
const CHANNEL_NAME: Record<string, string> = {
  telegram: "Telegram",
  web: "Web",
  whatsapp: "WhatsApp",
  cli: "Terminal",
  desktop: "Desktop",
  api: "API",
  web_sidebar: "Web",
  discord: "Discord",
};
/** v1's sidebar chat is its web chat. */
const SAME_AS: Record<string, string> = { web_sidebar: "web" };
const DONE_KEY = "v1_chats_imported";
const TEXT_MAX = 100_000;
/** What of a long chat goes to the model log, newest first: the rest stays visible in the chat. */
const LOG_CHARS = 200_000;

type Row = { ts: string; type: string; body: string; author?: string; meta: Record<string, unknown> };
export type V1Chat = {
  key: string;
  title: string;
  channel: string;
  /** A WhatsApp contact's chat id; none for the owner's own chats. */
  contact?: string;
  agent?: { project?: string; slug: string };
  rows: Row[];
};

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const listDir = (dir: string) => {
  try {
    return fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
};

/** A WhatsApp row from someone other than the owner. */
function contactOf(r: Row): string | undefined {
  const m = r.meta;
  if (m.role === "owner" || m.policy === "full" || m.audience === "owner") return undefined;
  return str(m.contact_key) ?? str(m.chat_jid);
}

/** The super-agent's chats, from ~/.apx/messages/<channel>/<day>.jsonl: one per channel, a contact or a Telegram chat. */
function ledgerChats(home: string): V1Chat[] {
  const chats = new Map<string, V1Chat>();
  /** Telegram chats by size: the biggest is the owner's own, the rest (groups) are titled apart. */
  const telegram = new Map<string, number>();
  for (const channel of CHANNELS) {
    const dir = path.join(home, "messages", channel);
    for (const file of listDir(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))) {
      const day = file.slice(0, 10);
      let text = "";
      try {
        text = fs.readFileSync(path.join(dir, file), "utf8");
      } catch {
        continue;
      }
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        let raw: Record<string, unknown>;
        try {
          raw = obj(JSON.parse(line));
        } catch {
          continue;
        }
        const row: Row = {
          ts: str(raw.ts) ?? `${day}T00:00:00.000Z`,
          type: str(raw.type) ?? "",
          body: typeof raw.body === "string" ? raw.body : "",
          ...(str(raw.author) ? { author: str(raw.author) } : {}),
          meta: obj(raw.meta),
        };
        const contact = channel === "whatsapp" ? contactOf(row) : undefined;
        // A Telegram group or a second chat is its own conversation, as in v1.
        const sub = contact ?? (channel === "telegram" ? str(String(row.meta.chat_id ?? "")) : undefined);
        const base = SAME_AS[channel] ?? channel;
        const key = `chat:${base}${sub ? `~${sub}` : ""}`;
        if (channel === "telegram" && sub) telegram.set(key, (telegram.get(key) ?? 0) + 1);
        let chat = chats.get(key);
        if (!chat) {
          chat = {
            key,
            title: contact
              ? `${CHANNEL_NAME[channel]} · ${row.author ?? contact}`
              : `${CHANNEL_NAME[base]}${sub ? ` · ${str(String(row.meta.chat_title ?? "")) ?? sub}` : ""}`,
            channel: base,
            ...(contact ? { contact } : {}),
            rows: [],
          };
          chats.set(key, chat);
        }
        if (contact && row.type === "user" && row.author) chat.title = `${CHANNEL_NAME[channel]} · ${row.author}`;
        chat.rows.push(row);
      }
    }
  }
  const own = [...telegram].sort((a, b) => b[1] - a[1])[0]?.[0];
  const ownChat = own ? chats.get(own) : undefined;
  if (ownChat) {
    ownChat.title = CHANNEL_NAME.telegram ?? "Telegram";
    // Rows v1 restored lost their chat id: they are the owner's own chat.
    const loose = chats.get("chat:telegram");
    if (loose) {
      ownChat.rows.push(...loose.rows);
      chats.delete("chat:telegram");
    }
  }
  // Days were read channel by channel: a merged chat (web and its sidebar) goes back in time order.
  for (const chat of chats.values()) chat.rows.sort((a, b) => a.ts.localeCompare(b.ts));
  return [...chats.values()];
}

/** "## user — 2026-09-01T10:00:00Z {json}" headings and their text, from a v1 conversation file. */
function conversationRows(body: string): Row[] {
  const rows: Row[] = [];
  const re = /^## (user|assistant|system|tool|compact) — (\S+)(?: (\{.*\}))?$/gm;
  const heads = [...body.matchAll(re)];
  heads.forEach((h, i) => {
    const end = heads[i + 1]?.index ?? body.length;
    const start = (h.index ?? 0) + h[0].length;
    let meta: Record<string, unknown> = {};
    try {
      meta = h[3] ? obj(JSON.parse(h[3])) : {};
    } catch {}
    const role = h[1] === "assistant" ? "agent" : (h[1] ?? "");
    rows.push({ ts: h[2] ?? "", type: role, body: body.slice(start, end).trim(), meta });
  });
  return rows;
}

/** Project agents' web and agent-to-agent chats, from ~/.apx/projects/<id>/agents/<slug>/conversations/*.md. */
function agentChats(home: string): V1Chat[] {
  const out: V1Chat[] = [];
  const root = path.join(home, "projects");
  for (const project of listDir(root)) {
    const agentsDir = path.join(root, project, "agents");
    for (const slug of listDir(agentsDir)) {
      const dir = path.join(agentsDir, slug, "conversations");
      for (const file of listDir(dir).filter((f) => f.endsWith(".md"))) {
        let text = "";
        try {
          text = fs.readFileSync(path.join(dir, file), "utf8");
        } catch {
          continue;
        }
        const { fields, body } = parseFrontmatter(text);
        const channel = String(fields.channel ?? "web");
        if (channel !== "web" && channel !== "a2a") continue;
        const rows = conversationRows(body);
        if (!rows.some((r) => r.type === "user" || r.type === "agent")) continue;
        out.push({
          key: `agent/${project}/${slug}/${file}`,
          title: String(fields.title ?? "").trim() || `${slug} · ${file.slice(0, 10)}`,
          channel,
          agent: { ...(project === "default" ? {} : { project }), slug },
          rows,
        });
      }
    }
  }
  return out;
}

export function v1Chats(home: string): V1Chat[] {
  return [...ledgerChats(home), ...agentChats(home)];
}

/** How many conversations and messages v1 has to bring. */
export function v1ChatCount(home: string): { chats: number; messages: number } {
  const chats = v1Chats(home);
  return {
    chats: chats.length,
    messages: chats.reduce((n, c) => n + c.rows.filter((r) => r.type === "user" || r.type === "agent").length, 0),
  };
}

/** The newest items that fit in `chars`, starting on the owner's words so the log reads as turns. */
function newest<T extends { role: string; content: string }>(items: T[], chars: number): T[] {
  let i = items.length;
  for (let used = 0; i > 0 && used + (items[i - 1]?.content.length ?? 0) <= chars; i--)
    used += items[i - 1]?.content.length ?? 0;
  while (i < items.length && items[i]?.role !== "user") i++;
  return items.slice(i);
}

/** A tool row as a finished tool call on the answer that follows it. */
function toolPart(r: Row, i: number): Part {
  const tool = str(r.meta.tool) ?? "tool";
  const failed = /^(error|failed)/i.test(String(obj(r.meta.result).error ?? r.meta.error ?? ""));
  return { type: "tool", call_id: `v1-${i}`, tool, title: tool, status: failed ? "error" : "ok" };
}

/**
 * Brings v1's chats in (once each). `agentFor` finds the v2 agent of a project agent's chat (or none); `persons`
 * maps a WhatsApp chat id to its contact.
 */
export function importV1Chats(
  store: Store,
  home: string,
  o: {
    secretaryId: string;
    agentFor(project: string | undefined, slug: string): { id: string; project_id?: string | undefined } | undefined;
  },
): number {
  const done = new Set<string>(JSON.parse(store.settings.get(DONE_KEY) ?? "[]") as string[]);
  let n = 0;
  for (const chat of v1Chats(home)) {
    if (done.has(chat.key)) continue;
    const agent = chat.agent ? o.agentFor(chat.agent.project, chat.agent.slug) : { id: o.secretaryId };
    if (!agent) continue;
    const person = chat.contact
      ? (store.persons.byAddress("whatsapp", chat.contact) ??
        store.persons.byAddress("whatsapp", chat.contact.replace(/@.*/, "")))
      : undefined;
    const first = chat.rows[0]?.ts;
    store.tx(() => {
      const thread = store.threads.create({
        kind: chat.channel === "a2a" ? "a2a" : "loose",
        title: chat.title.slice(0, 120),
        agent_ids: [agent.id],
        ...(agent.project_id ? { project_id: agent.project_id } : {}),
        at: first,
      });
      let tools: Part[] = [];
      let last = { at: first ?? "", text: "" };
      const log: Array<{ role: "user" | "assistant"; content: string }> = [];
      chat.rows.forEach((r, i) => {
        if (r.type === "tool") {
          tools.push(toolPart(r, i));
          return;
        }
        if (r.type !== "user" && r.type !== "agent") return;
        const text = r.body.slice(0, TEXT_MAX);
        if (!text.trim() && !tools.length) return;
        const author: Author =
          r.type === "agent"
            ? { kind: "agent", id: agent.id }
            : person
              ? { kind: "person", id: person.id, name: person.name, channel: chat.channel }
              : { kind: "user" };
        const parts: Part[] = r.type === "agent" ? [...tools, ...(text ? [{ type: "text" as const, text }] : [])] : [];
        if (r.type === "user") parts.push({ type: "text", text });
        tools = [];
        store.messages.add({
          thread_id: thread.id,
          author,
          parts,
          ...(r.type === "agent" && str(r.meta.model) ? { model: str(r.meta.model) } : {}),
          at: r.ts,
          quiet: true,
        });
        if (text) {
          log.push({ role: r.type === "agent" ? "assistant" : "user", content: text });
          last = { at: r.ts, text };
        }
      });
      // The model's view of the chat, so going on with it there has the earlier turns (its newest stretch).
      if (log.length) store.modelLog.append(thread.id, undefined, newest(log, LOG_CHARS));
      store.threads.settle(thread.id, last.at || first || new Date().toISOString(), last.text.slice(0, 140));
    });
    done.add(chat.key);
    n++;
  }
  store.settings.set(DONE_KEY, JSON.stringify([...done]));
  return n;
}

/** Default's agents in v1 live under ~/.apx/projects/default/.apc/agents: in v2 they are global agents. */
export function v1DefaultAgents(home: string) {
  return readAgentDir(path.join(home, "projects", "default", ".apc", "agents"));
}

/** Notes an agent kept for itself in v1 (~/.apx/projects/<id>/agents/<slug>/memory.md), one per line. */
export function v1AgentNotes(home: string): Array<{ project: string; slug: string; file: string }> {
  const out: Array<{ project: string; slug: string; file: string }> = [];
  const root = path.join(home, "projects");
  for (const project of listDir(root))
    for (const slug of listDir(path.join(root, project, "agents"))) {
      const file = path.join(root, project, "agents", slug, "memory.md");
      if (fs.existsSync(file)) out.push({ project, slug, file });
    }
  return out;
}
