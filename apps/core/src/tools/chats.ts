// search_chats / read_chat: what was said in the owner's other chats (a channel room, another agent's thread), so an
// agent can pick up a conversation it was not in. Owner turns only: a contact's sealed turn never gets these.
import type { Message, Thread } from "@apx/protocol";
import { z } from "zod";
import type { AgentRecord } from "../domain/agents.ts";
import type { Store } from "../domain/store.ts";
import { messageQuery } from "../domain/threads.ts";
import { cap, untrusted } from "./result.ts";
import { defineTool, type Tool } from "./types.ts";

const MESSAGE_CHARS = 1500;

/** Global agents share the owner's global chats; project teams stay within their scope. */
function canRead(store: Store, agent: AgentRecord, t: Thread): boolean {
  const context = store.threads.context(t.id);
  if (context.client) return false;
  if (agent.kind === "secretary" || t.agent_ids.includes(agent.id)) return true;
  if (agent.project_id) return t.project_id === agent.project_id;
  return !t.project_id && !t.channel && !context.room && !t.parent_id;
}

const readableChats = (store: Store, agent: AgentRecord) =>
  store.threads
    .list({ include_subthreads: true, include_archived: true, limit: null })
    .filter((t) => canRead(store, agent, t));

const wordsOf = (text: string): string[] => messageQuery(text)?.match(/[\p{L}\p{N}]+/gu) ?? [];

/** Agent names identify participants, rather than words that must occur in the message body. */
function searchScope(store: Store, agent: AgentRecord, query: string) {
  const words = wordsOf(query);
  const named = store.agents.list().filter((a) => {
    if (a.project_id && a.project_id !== agent.project_id) return false;
    const name = wordsOf(a.name);
    return name.length > 0 && name.every((w) => words.includes(w));
  });
  const names = new Set(named.flatMap((a) => wordsOf(a.name)));
  const text = words.filter((w) => !names.has(w)).join(" ");
  const chats = readableChats(store, agent).filter(
    (t) => !named.length || named.some((a) => t.agent_ids.includes(a.id)),
  );
  return { text, chats };
}

function authorOf(store: Store, m: Message): string {
  const a = m.author;
  if (a.kind === "user") return "Owner";
  if (a.kind === "agent") return store.agents.get(a.id)?.name ?? a.id;
  if (a.kind === "person") return `${a.name} (${a.channel})`;
  if (a.kind === "surface") return a.title;
  return "APX";
}

const textOf = (m: Message) =>
  m.parts
    .flatMap((p) => (p.type === "text" ? [p.text] : []))
    .join("\n")
    .trim();

const when = (iso: string) => iso.slice(0, 16).replace("T", " ");

/** A chat named by its id, or by its title ("#general", "Home"): exact first, then the latest that contains it. */
function findChat(store: Store, agent: AgentRecord, name: string): Thread | undefined {
  const byId = store.threads.get(name);
  if (byId) return canRead(store, agent, byId) ? byId : undefined;
  const q = name.trim().toLowerCase();
  const all = readableChats(store, agent);
  const exact = all.find((t) => t.title.toLowerCase() === q);
  if (exact) return exact;
  const found = store.agents.resolve(name, agent.project_id);
  if (!("error" in found)) {
    const chats = all.filter((t) => t.agent_ids.includes(found.agent.id));
    return chats.find((t) => t.kind === "home") ?? chats[0];
  }
  return all.find((t) => t.title.toLowerCase().includes(q));
}

export function chatTools(store: Store): Tool[] {
  return [
    defineTool({
      name: "search_chats",
      description:
        "Search what was said in the owner's other chats (channel rooms like a Discord #general, other agents' threads, earlier chats): Use topic keywords; agent names filter chat participants. Messages with every topic word, best match first. Then read_chat to see one in full. If unavailable, ask the named agent with delegate before asking the owner to repeat context.",
      args: z.object({
        query: z.string().min(2).describe("words to find"),
        limit: z.number().int().min(1).max(20).optional().describe("how many messages (default 10)"),
      }),
      effect: "none",
      deadlineMs: 5_000,
      title: (a) => `Searched chats for “${a.query}”`,
      async run(a, ctx) {
        const scope = searchScope(store, ctx.agent, a.query);
        const chats = scope.chats.filter((t) => t.id !== ctx.thread.id);
        if (!scope.text) {
          const rows = chats.slice(0, a.limit ?? 10).map((t) => `- ${t.title} (chat ${t.id})`);
          return rows.length
            ? untrusted("chats", { query: a.query }, rows.join("\n"))
            : "no accessible chats match; use list_agents and delegate to ask the named agent for context";
        }
        const byId = new Map(chats.map((t) => [t.id, t]));
        const rows = store.messages
          .search(scope.text, a.limit ?? 10, [...byId.keys()])
          .map(({ message: m, snippet }) => {
            const t = byId.get(m.thread_id) as Thread;
            return `- [${t.title} · chat ${t.id}] ${when(m.created_at)} ${authorOf(store, m)}: ${snippet}`;
          });
        return rows.length
          ? untrusted("chats", { query: a.query }, rows.join("\n"))
          : "no message in accessible chats matches; try fewer topic keywords, or use list_agents and delegate to ask the named agent for context";
      },
    }),
    defineTool({
      name: "read_chat",
      description:
        "Read the latest messages of one of the owner's chats, by its id, title (for example #general), or agent name (prefers their Home chat). Without one that matches, lists the chats you can read.",
      args: z.object({
        chat: z.string().min(1).describe("the chat's id or title"),
        limit: z.number().int().min(1).max(60).optional().describe("how many of its latest messages (default 20)"),
      }),
      effect: "none",
      deadlineMs: 5_000,
      title: (a) => `Read the chat ${a.chat}`,
      async run(a, ctx) {
        const t = findChat(store, ctx.agent, a.chat);
        if (!t) {
          const known = readableChats(store, ctx.agent)
            .slice(0, 15)
            .map((x) => `- ${x.title} (chat ${x.id})`);
          return `no chat named "${a.chat}" that you can read. Use list_agents and delegate to ask the named agent for context. Recent chats:\n${known.join("\n")}`;
        }
        const lines = store.messages.list(t.id, a.limit ?? 20).flatMap((m) => {
          const text = textOf(m);
          return text ? [`${when(m.created_at)} ${authorOf(store, m)}: ${cap(text, MESSAGE_CHARS)}`] : [];
        });
        return untrusted("chat", { title: t.title, id: t.id }, lines.length ? lines.join("\n\n") : "(no messages)");
      },
    }),
  ];
}
