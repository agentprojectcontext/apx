// search_chats / read_chat: what was said in the owner's other chats (a channel room, another agent's thread), so an
// agent can pick up a conversation it was not in, and this chat's own turns older than the model's view. Owner turns
// only: a contact's sealed turn never gets these.
import type { Message, Thread } from "@apx/protocol";
import { z } from "zod";
import type { AgentRecord } from "../domain/agents.ts";
import { canReadChat as canRead } from "../domain/chat-access.ts";
import type { Store } from "../domain/store.ts";
import { messageQuery } from "../domain/threads.ts";
import { cap, untrusted } from "./result.ts";
import { defineTool, type Tool } from "./types.ts";

const MESSAGE_CHARS = 1500;
/** A found tool call shows the head of its arguments and of its result: enough to recognise it. */
const CALL_CHARS = 300;

const readableChats = (store: Store, agent: AgentRecord) =>
  store.threads
    .list({ include_subthreads: true, include_archived: true, limit: null })
    .filter((t) => canRead(store, agent, t));

const wordsOf = (text: string): string[] => messageQuery(text)?.match(/[\p{L}\p{N}]+/gu) ?? [];

/** Agent names identify participants, rather than words that must occur in the message body. */
function searchScope(store: Store, agent: AgentRecord, query: string) {
  const words = wordsOf(query);
  const used = new Set<number>();
  const named = store.agents
    .list()
    .filter((a) => !a.project_id || a.project_id === agent.project_id)
    .map((a) => ({ agent: a, words: wordsOf(a.name) }))
    .sort((a, b) => b.words.length - a.words.length)
    .filter((a) => {
      if (!a.words.length) return false;
      const at = words.findIndex((_w, i) => a.words.every((w, j) => words[i + j] === w && !used.has(i + j)));
      if (at < 0) return false;
      for (let i = 0; i < a.words.length; i++) used.add(at + i);
      return true;
    })
    .map((a) => a.agent);
  const names = new Set(named.flatMap((a) => wordsOf(a.name)));
  const text = words.filter((w) => !names.has(w)).join(" ");
  const chats = readableChats(store, agent).filter((t) => named.every((a) => t.agent_ids.includes(a.id)));
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
function findChat(
  store: Store,
  agent: AgentRecord,
  current: Thread,
  name: string,
): Thread | { ambiguous: Thread[] } | undefined {
  const byId = store.threads.get(name);
  if (byId) return canRead(store, agent, byId) ? byId : undefined;
  const q = name.trim().toLowerCase();
  const all = readableChats(store, agent);
  const exact = all.find((t) => t.title.toLowerCase() === q);
  if (exact) return exact;
  const sessions = all.filter((t) => t.session?.toLowerCase() === q);
  const local = sessions.find((t) => t.parent_id === current.id);
  if (local) return local;
  if (sessions.length) return sessions.length === 1 ? sessions[0] : { ambiguous: sessions };
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
        "Search what was said and done in the owner's chats (channel rooms like Discord #general, other agents' threads, earlier chats, routine runs, this chat before your view): Use topic keywords; agent names filter chat participants. Messages with every topic word, best match first, then tool calls whose tool or arguments hold them (what was published, sent or read). Then read_chat to see one.",
      args: z.object({
        query: z.string().min(2).describe("words to find"),
        limit: z.number().int().min(1).max(20).optional().describe("how many messages (default 10)"),
      }),
      effect: "none",
      deadlineMs: 5_000,
      title: (a) => `Searched chats for “${a.query}”`,
      async run(a, ctx) {
        const scope = searchScope(store, ctx.agent, a.query);
        // This chat counts only when the turn says what of it the model already sees; that part is not searched.
        const inView = [...(ctx.inView?.() ?? [])];
        const others = scope.chats.filter((t) => t.id !== ctx.thread.id);
        const chats = inView.length ? scope.chats : others;
        if (!scope.text) {
          const rows = others.slice(0, a.limit ?? 10).map((t) => `- ${t.title} (chat ${t.id})`);
          return rows.length
            ? untrusted("chats", { query: a.query }, rows.join("\n"))
            : "no accessible chats match; use list_agents and delegate to ask the named agent for context";
        }
        const byId = new Map(chats.map((t) => [t.id, t]));
        const rows = store.messages
          .search(scope.text, a.limit ?? 10, [...byId.keys()], {
            runs: inView,
            messages: inView.flatMap((id) => store.memorySources.forRun(id)),
          })
          .filter(
            ({ message: m }) =>
              !store.memories.excluded({ agent_id: ctx.agent.id, project_id: ctx.thread.project_id }, textOf(m), {
                message_id: m.id,
                ...(m.run_id ? { run_id: m.run_id } : {}),
              }),
          )
          .map(({ message: m, snippet }) => {
            const t = byId.get(m.thread_id) as Thread;
            return `- [${t.title} · chat ${t.id}] ${when(m.created_at)} ${authorOf(store, m)}: ${snippet} (message ${m.id})`;
          });
        const calls = store.runs
          .searchSteps(wordsOf(scope.text), [...byId.keys()], a.limit ?? 10, inView)
          .filter(
            (c) =>
              !store.memories.excluded(
                { agent_id: ctx.agent.id, project_id: ctx.thread.project_id },
                `${c.args} ${c.result ?? ""}`,
                { run_id: c.run_id },
              ),
          )
          .map((c) => {
            const t = byId.get(c.thread_id) as Thread;
            const who = store.agents.get(c.agent_id)?.name ?? c.agent_id;
            const result = c.result ? ` → ${cap(c.result, CALL_CHARS)}` : "";
            return `- [${t.title} · chat ${t.id}] ${when(c.started_at)} ${who} called ${c.tool} ${cap(c.args, CALL_CHARS)}${result}`;
          });
        const found = [...rows, ...(calls.length ? ["Tool calls:", ...calls] : [])];
        return found.length
          ? untrusted("chats", { query: a.query }, found.join("\n"))
          : "no message or tool call in accessible chats matches; try fewer topic keywords, or use list_agents and delegate to ask the named agent for context";
      },
    }),
    defineTool({
      name: "read_chat",
      description:
        "Read a chat by id, title, delegation session or agent (prefers Home). around expands an older message; otherwise latest. No match lists accessible chats.",
      args: z.object({
        chat: z.string().min(1).describe("the chat's id or title"),
        limit: z.number().int().min(1).max(60).optional().describe("how many messages (default 20)"),
        around: z.string().optional().describe("source message id: expand older context"),
      }),
      effect: "none",
      deadlineMs: 5_000,
      title: (a) => `Read the chat ${a.chat}`,
      async run(a, ctx) {
        const t = findChat(store, ctx.agent, ctx.thread, a.chat);
        if (t && "ambiguous" in t)
          return untrusted(
            "chats",
            { session: a.chat },
            `Ambiguous session name; read_chat with one chat id:\n${t.ambiguous.map((x) => `- ${x.title} (chat ${x.id})`).join("\n")}`,
          );
        if (!t) {
          const known = readableChats(store, ctx.agent)
            .slice(0, 15)
            .map((x) => `- ${x.title} (chat ${x.id})`);
          return `no chat named "${a.chat}" that you can read. Use list_agents and delegate to ask the named agent for context. Recent chats:\n${known.join("\n")}`;
        }
        const anchor = a.around ? store.messages.get(a.around) : undefined;
        if (a.around && (!anchor || anchor.thread_id !== t.id)) return "message not found in this chat";
        const messages = anchor
          ? store.messages.around(t.id, anchor.seq, a.limit ?? 20)
          : store.messages.list(t.id, a.limit ?? 20);
        const lines = messages
          .filter(
            (m) =>
              !store.memories.excluded({ agent_id: ctx.agent.id, project_id: ctx.thread.project_id }, textOf(m), {
                message_id: m.id,
                ...(m.run_id ? { run_id: m.run_id } : {}),
              }),
          )
          .flatMap((m) => {
            const text = textOf(m);
            const attachments = m.parts
              .flatMap((p) =>
                p.type === "image" || p.type === "file" || p.type === "audio" ? [JSON.stringify(p)] : [],
              )
              .join("\n");
            const content = [cap(text, MESSAGE_CHARS), cap(attachments, MESSAGE_CHARS)].filter(Boolean).join("\n");
            return content ? [`${when(m.created_at)} ${authorOf(store, m)}: ${content}`] : [];
          });
        return untrusted("chat", { title: t.title, id: t.id }, lines.length ? lines.join("\n\n") : "(no messages)");
      },
    }),
  ];
}
