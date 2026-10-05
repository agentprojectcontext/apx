// search_chats / read_chat: what was said in the owner's other chats (a channel room, another agent's thread), so an
// agent can pick up a conversation it was not in. Owner turns only: a contact's sealed turn never gets these.
import type { Message, Thread } from "@apx/protocol";
import { z } from "zod";
import type { AgentRecord } from "../domain/agents.ts";
import type { Store } from "../domain/store.ts";
import { cap, untrusted } from "./result.ts";
import { defineTool, type Tool } from "./types.ts";

const MESSAGE_CHARS = 1500;

/** The super-agent reads every chat; another agent the chats of its project and the ones it takes part in. */
function canRead(agent: AgentRecord, t: Thread): boolean {
  if (agent.kind === "secretary") return true;
  return t.agent_ids.includes(agent.id) || (Boolean(agent.project_id) && t.project_id === agent.project_id);
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
  if (byId) return canRead(agent, byId) ? byId : undefined;
  const q = name.trim().toLowerCase();
  const all = store.threads.list({ include_subthreads: true }).filter((t) => canRead(agent, t));
  return all.find((t) => t.title.toLowerCase() === q) ?? all.find((t) => t.title.toLowerCase().includes(q));
}

export function chatTools(store: Store): Tool[] {
  return [
    defineTool({
      name: "search_chats",
      description:
        "Search what was said in the owner's other chats (channel rooms like a Discord #general, other agents' threads, earlier chats): messages with every word given, best match first. Then read_chat to see one in full.",
      args: z.object({
        query: z.string().min(2).describe("words to find"),
        limit: z.number().int().min(1).max(20).optional().describe("how many messages (default 10)"),
      }),
      effect: "none",
      deadlineMs: 5_000,
      title: (a) => `Searched chats for “${a.query}”`,
      async run(a, ctx) {
        const rows = store.messages
          .search(a.query, 50)
          .flatMap(({ message: m, snippet }) => {
            if (m.thread_id === ctx.thread.id) return [];
            const t = store.threads.get(m.thread_id);
            return t && canRead(ctx.agent, t) ? [{ m, t, snippet }] : [];
          })
          .slice(0, a.limit ?? 10)
          .map(
            ({ m, t, snippet }) =>
              `- [${t.title} · chat ${t.id}] ${when(m.created_at)} ${authorOf(store, m)}: ${snippet}`,
          );
        return rows.length
          ? untrusted("chats", { query: a.query }, rows.join("\n"))
          : "no message in other chats matches";
      },
    }),
    defineTool({
      name: "read_chat",
      description:
        "Read the latest messages of one of the owner's chats, by its id or its title (for example #general). Without one that matches, lists the chats you can read.",
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
          const known = store.threads
            .list()
            .filter((x) => canRead(ctx.agent, x))
            .slice(0, 15)
            .map((x) => `- ${x.title} (chat ${x.id})`);
          return `no chat named "${a.chat}" that you can read. Recent chats:\n${known.join("\n")}`;
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
