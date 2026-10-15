// The reply a supervised contact would get, drafted and not sent: one model call with the same sealed prompt as their
// turns (who they are, the owner's rules) over their chat, no tools. The owner decides what goes out
// (channels/suggestions.ts).
import type { AgentRecord } from "../domain/agents.ts";
import { isCliRef } from "../domain/refs.ts";
import type { Store } from "../domain/store.ts";
import { candidates, modelSettings } from "../models/choice.ts";
import type { Llm } from "../providers/llm.ts";
import type { ChatItem } from "../providers/types.ts";
import { audienceOf, contactPrompt } from "./audience.ts";
import { project } from "./context.ts";

/** Less history than a turn: a draft answers the last few messages, not a long task. */
const DRAFT_HISTORY_CHARS = 30_000;
const DRAFT_TIMEOUT_MS = 90_000;

export type Draft = { text: string; model: string };

export function createDrafter(deps: {
  store: Store;
  llm: Llm;
  /** API models for an agent whose own runs on a CLI (the auxiliary chain), so a draft never needs a whole turn. */
  fallbackModels: (agentId: string) => string[];
}) {
  const { store, llm } = deps;

  /** The agent's own models, as its turns in this chat would pick them; the API ones only. */
  function modelsFor(threadId: string, agent: AgentRecord, said: string): string[] {
    const settings = modelSettings(store);
    const chosen = store.threads.context(threadId).model_choice ?? agent.model_choice ?? settings.defaultChoice();
    const refs = candidates(chosen, settings.router(), {
      text: said,
      context_chars: 0,
      has_image: false,
      channel: store.threads.get(threadId)?.channel?.id ?? "app",
      trigger: "channel",
      agent_kind: agent.kind,
    }).filter((r) => !isCliRef(r));
    return refs.length ? refs : deps.fallbackModels(agent.id);
  }

  /** Throws when no model answered; `text` is empty when the model said nothing needs an answer. */
  async function draft(threadId: string, agentId: string, signal?: AbortSignal): Promise<Draft> {
    const thread = store.threads.get(threadId);
    const agent = store.agents.get(agentId);
    if (!thread || !agent) throw new Error("the chat or its agent is gone");
    const audience = audienceOf(store, thread);
    if (audience.kind !== "contact" || audience.room) throw new Error("only a contact's chat gets drafts");
    const lang = store.settings.get("owner_language") || "es";
    const { items } = project(
      store.modelLog.list(threadId),
      DRAFT_HISTORY_CHARS,
      store.threads.context(threadId).compaction,
    );
    const history = plain(items);
    const models = modelsFor(threadId, agent, String(history.at(-1)?.content ?? ""));
    if (!models.length) throw new Error("no model API is set up for this agent");
    const name = audience.name;
    const r = await llm.complete({
      models,
      messages: [
        { role: "system", content: contactPrompt(agent, audience, lang) },
        ...history,
        {
          role: "user",
          content: `<system_note>\nWrite the message you would send ${name} now, answering their latest messages above. Your owner reads it before it goes out. Write only the message itself, as you would send it; nothing else.\n</system_note>`,
        },
      ],
      tools: [],
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(DRAFT_TIMEOUT_MS)])
        : AbortSignal.timeout(DRAFT_TIMEOUT_MS),
      cacheKey: threadId,
    });
    if (r.usage) store.auxCalls.add({ purpose: "suggestion", thread_id: threadId }, r.model, r.usage);
    const text = typeof r.message.content === "string" ? r.message.content.trim() : "";
    return { text, model: r.model };
  }

  return { draft };
}

/**
 * The chat as words only: tool calls and results of earlier turns stay out (a call with no tools offered would be
 * refused by some providers), and an assistant turn that only called tools leaves nothing.
 */
function plain(items: ChatItem[]): ChatItem[] {
  return items.flatMap((m): ChatItem[] => {
    if (m.role === "user") return [m];
    if (m.role === "assistant") return m.content ? [{ role: "assistant", content: m.content }] : [];
    return [];
  });
}
