// Release news told by the super-agent: once per entry, only the entries that apply to this owner, in one short
// message in its voice and the owner's language, on their preferred channel. A release with nothing that applies costs
// no model call; a fresh install is told nothing. See rules/DECISIONS.md#d-117
import { buttonId } from "../channels/notices.ts";
import type { Presentation } from "../domain/channels.ts";
import { HOME_THREAD_ID } from "../domain/seed.ts";
import type { Store } from "../domain/store.ts";
import { previewOf } from "../domain/threads.ts";
import type { Log } from "../log.ts";
import type { Llm } from "../providers/llm.ts";
import { compareVersions } from "../release-notes.ts";
import { NEWS, type NewsEntry, newsFacts } from "./entries.ts";

/** The entries already told (or known from the start), as a JSON list of ids. */
const SEEN_KEY = "news_seen";
/** Buttons under one message: more would be a menu, not a suggestion. */
const MAX_ACTIONS = 3;
/** A few sentences: the deadline and the cap keep a slow or chatty model from holding the boot's work. */
const TIMEOUT_MS = 60_000;
const MAX_OUTPUT_TOKENS = 400;
const MAX_CHARS = 1200;

export type NewsItem = {
  id: string;
  since: string;
  title: string;
  seen: boolean;
  applies: boolean;
  actions: string[];
};

export type NewsTold = {
  told: string[];
  /** The home chat the message was posted in; absent when nothing was told. */
  thread?: string;
  /** A channel (or the phone) took it; false: only the app has it. */
  sent: boolean;
  /** Written by the model; false: the plain English text (no API model for the super-agent). */
  voiced: boolean;
};

export function createNews(deps: {
  store: Store;
  llm: Llm;
  /** The API models the super-agent's turns go to (never a CLI), then the auxiliary one. */
  models: (agentId: string) => string[];
  notifyOwner: (body: Presentation, threadId: string) => boolean;
  log: Log;
  /** APX's own entries unless a test brings its own. */
  entries?: readonly NewsEntry[];
  timeoutMs?: number;
}) {
  const { store, log } = deps;
  const entries = deps.entries ?? NEWS;
  const ac = new AbortController();
  let running: Promise<unknown> = Promise.resolve();

  const seenIds = (): Set<string> | undefined => {
    const raw = store.settings.get(SEEN_KEY);
    if (raw === undefined) return undefined;
    try {
      const ids: unknown = JSON.parse(raw);
      return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : []);
    } catch {
      return new Set();
    }
  };
  const markSeen = (ids: Iterable<string>) =>
    store.settings.set(SEEN_KEY, JSON.stringify([...new Set([...(seenIds() ?? []), ...ids])]));

  function list(): NewsItem[] {
    const seen = seenIds() ?? new Set();
    const facts = newsFacts(store);
    return entries.map((e) => ({
      id: e.id,
      since: e.since,
      title: e.title,
      seen: seen.has(e.id),
      applies: e.applies(facts),
      actions: e.actions.map((a) => a.label.en),
    }));
  }

  /** One at a time: a boot's telling and a replay never write two messages for the same entries. */
  function serial<T>(work: () => Promise<T>): Promise<T> {
    const next = running.then(work, work);
    running = next.catch(() => {});
    return next;
  }

  /**
   * At start: a fresh install (nothing said yet) knows every entry as a capability and is told none; an install that
   * was already on an entry's release when news began knows it too. Then the unseen entries that apply are told.
   */
  function atBoot(previousRelease?: string): Promise<NewsTold> {
    return serial(async () => {
      if (!seenIds()) {
        if (!store.messages.anyFromOwner()) {
          markSeen(entries.map((e) => e.id));
          return { told: [], sent: false, voiced: false };
        }
        markSeen(
          previousRelease ? entries.filter((e) => compareVersions(e.since, previousRelease) <= 0).map((e) => e.id) : [],
        );
      }
      return deliver(pending());
    });
  }

  const pending = () => {
    const seen = seenIds() ?? new Set();
    const facts = newsFacts(store);
    return entries.filter((e) => !seen.has(e.id) && e.applies(facts));
  };

  /** Tells these entries now (seen or not, applying or not: a replay), else the unseen ones that apply. */
  function tell(ids?: string[]): Promise<NewsTold> {
    return serial(async () => {
      if (!ids?.length) return deliver(pending());
      const unknown = ids.filter((id) => !entries.some((e) => e.id === id));
      if (unknown.length) throw new Error(`no such news: ${unknown.join(", ")}`);
      return deliver(entries.filter((e) => ids.includes(e.id)));
    });
  }

  async function deliver(told: NewsEntry[]): Promise<NewsTold> {
    if (!told.length) return { told: [], sent: false, voiced: false };
    const boss = store.agents.list().find((a) => a.kind === "secretary");
    const home = store.threads.get(HOME_THREAD_ID);
    if (!boss || !home) return { told: [], sent: false, voiced: false };
    const lang = store.settings.get("owner_language") || "es";
    const actions = told.length === 1 ? (told[0]?.actions ?? []) : told.flatMap((e) => e.actions.slice(0, 1));
    const shown = actions.slice(0, MAX_ACTIONS);
    const voiced = await voice(boss, told, lang, actions.length - shown.length);
    const text =
      voiced ??
      plainText(
        told,
        shown.map((a) => a.label.en),
      );
    store.tx(() => {
      store.messages.add({
        thread_id: home.id,
        author: { kind: "agent", id: boss.id },
        parts: [{ type: "text", text }],
      });
      // The agent reads its message as its own words when the owner answers it here.
      store.modelLog.append(home.id, undefined, [
        {
          role: "user",
          content: `<system_note>\nAPX was updated; you told the owner what is new for them.\n</system_note>`,
        },
        { role: "assistant", content: text },
      ]);
      store.threads.patch(home.id, { preview: previewOf(text), unread: (home.unread ?? 0) + 1 });
    });
    const buttons = shown.map((a) => {
      const entry = told.find((e) => e.actions.includes(a));
      return { id: buttonId.news(entry?.id ?? "", entry?.actions.indexOf(a) ?? 0), label: labelOf(a, lang) };
    });
    const sent = deps.notifyOwner({ text, ...(buttons.length ? { buttons } : {}) }, home.id);
    // Posted in the app either way: the owner has it, so it is not told again.
    markSeen(told.map((e) => e.id));
    log.info({ news: told.map((e) => e.id), sent, voiced: voiced !== undefined }, "release news told");
    return { told: told.map((e) => e.id), thread: home.id, sent, voiced: voiced !== undefined };
  }

  /**
   * The super-agent's own words: one model call, no tools, a capped answer. Undefined when it has no API model;
   * a failing call throws, so nothing is marked seen and the next start tries again.
   */
  async function voice(
    boss: { id: string; name: string; personality?: string | undefined },
    told: NewsEntry[],
    lang: string,
    moreActions: number,
  ): Promise<string | undefined> {
    const models = deps.models(boss.id);
    if (!models.length) return undefined;
    const signal = AbortSignal.any([ac.signal, AbortSignal.timeout(deps.timeoutMs ?? TIMEOUT_MS)]);
    const r = await deps.llm.complete({
      models,
      messages: [
        { role: "system", content: voicePrompt(boss) },
        { role: "user", content: newsInput(told, lang, moreActions) },
      ],
      tools: [],
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      signal,
    });
    if (r.usage) store.auxCalls.add({ purpose: "news", thread_id: HOME_THREAD_ID }, r.model, r.usage);
    const out = typeof r.message.content === "string" ? r.message.content.trim() : "";
    if (!out) throw new Error("the model wrote nothing");
    return out.slice(0, MAX_CHARS);
  }

  return {
    list,
    atBoot,
    tell,
    stop: async () => {
      ac.abort(new Error("shutting down"));
      await running.catch(() => {});
    },
  };
}

export type News = ReturnType<typeof createNews>;

const labelOf = (a: NewsEntry["actions"][number], lang: string) => (lang === "es" ? a.label.es : a.label.en);

const voicePrompt = (boss: { name: string; personality?: string | undefined }) =>
  `You are ${boss.name}, the owner's assistant in APX, the app you run in.${boss.personality ? ` Your personality: ${boss.personality}` : ""}`;

/** A few hundred characters: what is new for this owner, and how the message should read. */
export function newsInput(told: NewsEntry[], lang: string, moreActions: number): string {
  const items = told.map((e) => `- ${e.text}`).join("\n");
  const offers = told
    .flatMap((e) => (told.length === 1 ? e.actions : e.actions.slice(0, 1)))
    .slice(0, MAX_ACTIONS)
    .map((a) => `"${a.label.en}"`)
    .join(", ");
  return [
    "APX was updated. What is new that you can now do for the owner:",
    items,
    `Write them a short message (two to four sentences, plain text, no Markdown) in your voice, in their language (${lang}), saying what this means for them and offering: ${offers}.${moreActions > 0 ? ` Add that there are ${moreActions} more things you can show them.` : ""} They can pick one or just answer you. Write only the message.`,
  ].join("\n");
}

/** Without a model: the entries as they are, in English. */
function plainText(told: NewsEntry[], offers: string[]): string {
  const items = told.map((e) => `- ${e.text}`).join("\n");
  return `APX has something new for you:\n\n${items}${offers.length ? `\n\nWant me to: ${offers.join(", or ")}? Just answer me.` : ""}`;
}
