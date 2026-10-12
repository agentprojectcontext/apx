import type { Message as Msg, Thread } from "@apx/protocol";
import { ActivityPill, AgentAvatar, DayDivider, EmptyState, Icons, Message, SystemNote, withMentions } from "@apx/ui";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { ReactionList } from "../channels/MessageMarks.tsx";
import { dayLabel, sameDay } from "../common/format.ts";
import { useEngineLabel } from "../common/useEngineLabel.ts";
import { blobOf, isWorking, routineName, threadAgent } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useLanguage, useT } from "../i18n/index.ts";
import { nav, useNav } from "../shell/nav.ts";
import { AgentTurn } from "./AgentTurn.tsx";
import { MessageActions } from "./MessageActions.tsx";
import { AudioPart } from "./parts/AudioPart.tsx";
import { FilePart } from "./parts/FilePart.tsx";
import { ImagePart } from "./parts/ImagePart.tsx";
import { NoticePart } from "./parts/NoticePart.tsx";
import { quotedIndex, quoteParts, splitQuote } from "./quote.ts";
import { Regenerate, UserMessage } from "./Rewind.tsx";

const EMPTY: Msg[] = [];
/** Distance from the bottom (px) under which new content keeps the view pinned to the end. */
const STICK_PX = 120;

/** `comments`: a task's conversation, read as comments (no skill chips on the agents' answers). */
export function Transcript({ thread, comments = false }: { thread: Thread; comments?: boolean }) {
  const t = useT();
  const lang = useLanguage();
  const messages = useData((s) => s.messages[thread.id] ?? EMPTY);
  const agents = useData((s) => s.agents);
  const engineLabel = useEngineLabel(thread.engine);
  const engine = thread.engine && engineLabel ? { id: thread.engine, label: engineLabel } : undefined;
  const showTools = useNav((s) => s.tools);
  const agent = threadAgent(thread, agents);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const multiAgent = thread.kind === "a2a" || thread.kind === "task" || thread.agent_ids.length > 1;

  // biome-ignore lint/correctness/useExhaustiveDependencies: day labels are re-made when the language changes
  const rows = useMemo(() => {
    const out: { key: string; day?: string; msg: Msg }[] = [];
    let prev: string | undefined;
    for (const m of messages) {
      out.push({ key: m.id, day: !prev || !sameDay(prev, m.created_at) ? dayLabel(m.created_at) : undefined, msg: m });
      prev = m.created_at;
    }
    return out;
  }, [messages, lang]);

  // Thread switch: jump to the end.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs per thread id on purpose
  useLayoutEffect(() => {
    stick.current = true;
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.id]);

  // New content: follow it only if the reader was already at the bottom.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when content changes
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, thread.state]);

  // Late growth (widgets sizing themselves, images): stay pinned if the reader was at the end.
  useEffect(() => {
    const el = scroller.current;
    const inner = content.current;
    if (!el || !inner) return;
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  // A search result points at one message ("msg:<id>"): scroll to it once it is loaded, and light it for a moment.
  const focus = useNav((s) => s.focus);
  // biome-ignore lint/correctness/useExhaustiveDependencies: tried again as the thread's messages arrive
  useEffect(() => {
    if (!focus?.startsWith("msg:")) return;
    const row = content.current?.querySelector<HTMLElement>(`[data-msg="${CSS.escape(focus.slice(4))}"]`);
    if (!row) return;
    stick.current = false;
    nav.set({ focus: undefined });
    row.scrollIntoView({ block: "center" });
    row.classList.add("is-flash");
    row.addEventListener("animationend", () => row.classList.remove("is-flash"), { once: true });
  }, [focus, rows]);

  const onScroll = () => {
    const el = scroller.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
  };

  // A reply's quote leads back to the message it was taken from.
  const texts = useMemo(() => messages.map(textOf), [messages]);
  const quoted = (id: string, quote: string) => {
    const i = quotedIndex(
      texts,
      messages.findIndex((m) => m.id === id),
      quote,
    );
    return i >= 0 ? messages[i]?.id : undefined;
  };

  const working = isWorking(thread.state);
  return (
    <div className="chat__scroll" ref={scroller} onScroll={onScroll}>
      <div className="transcript" ref={content}>
        {rows.length === 0 && !working && (
          <EmptyState
            icon={<Icons.MessageCircle />}
            title={t("chat.with", { name: engineLabel ?? agent?.name ?? thread.title })}
          >
            {t("chat.startHint")}
          </EmptyState>
        )}
        {rows.map(({ key, day, msg }) => (
          <div key={key} className="transcript__row" data-msg={key}>
            {day && <DayDivider label={day} />}
            {thread.kind === "routine" && msg.author.kind === "user" && key === rows[0]?.key ? (
              <RoutinePrompt name={routineName(thread)} text={textOf(msg)} />
            ) : msg.author.kind === "user" ? (
              <UserMessage
                thread={thread}
                message={msg}
                messages={messages}
                text={textOf(msg)}
                reactions={
                  msg.reactions?.length ? (
                    <ReactionList list={msg.reactions} agentName={agent?.name ?? ""} />
                  ) : undefined
                }
              >
                <UserFiles message={msg} />
                <UserText text={textOf(msg)} sourceOf={(quote) => quoted(msg.id, quote)} />
              </UserMessage>
            ) : msg.author.kind === "system" ? (
              <SystemMessage message={msg} />
            ) : msg.author.kind === "person" ? (
              <Message
                from="agent"
                variant="bubble"
                avatar={<AgentAvatar name={msg.author.name} size={24} />}
                meta={<span className="transcript__person">{msg.author.name}</span>}
                reactions={
                  msg.reactions?.length ? (
                    <ReactionList list={msg.reactions} agentName={agent?.name ?? ""} />
                  ) : undefined
                }
                actions={<MessageActions thread={thread} message={msg} text={textOf(msg)} speechKey={msg.id} />}
              >
                <UserFiles message={msg} />
                <UserText text={textOf(msg)} sourceOf={(quote) => quoted(msg.id, quote)} />
              </Message>
            ) : msg.author.kind === "surface" ? (
              <SystemNote icon={<Icons.LayoutGrid size={12} />} className="transcript__fromsurface">
                {t("chat.fromWidget")} <b>{msg.author.title}</b>: {textOf(msg)}
              </SystemNote>
            ) : (
              <AgentTurn
                thread={thread}
                message={msg}
                agent={agents[msg.author.id]}
                showAvatar={multiAgent}
                showTools={showTools}
                showSkills={!comments}
                engine={engine}
                actions={<Regenerate thread={thread} message={msg} messages={messages} />}
              />
            )}
          </div>
        ))}
        {working && (
          <div className="transcript__activity">
            <ActivityPill
              tone="brand"
              label={t("chat.agentWorking", { name: agent?.name ?? t("chat.theAgent") })}
              from={agent && <AgentAvatar name={agent.name} blob={blobOf(agent)} size={22} />}
            />
          </div>
        )}
        {thread.state === "input-required" && (
          <div className="transcript__activity">
            <ActivityPill tone="danger" label={t("chat.agentWaiting", { name: agent?.name ?? t("chat.theAgent") })} />
          </div>
        )}
      </div>
    </div>
  );
}

/** What APX itself says in a thread: notices (paused, summarized) and plain notes. */
function SystemMessage({ message }: { message: Msg }) {
  const notices = message.parts.filter((p) => p.type === "notice");
  if (!notices.length) return <SystemNote>{textOf(message)}</SystemNote>;
  return (
    <>
      {notices.map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a message's parts never reorder.
        <NoticePart key={i} part={p} />
      ))}
    </>
  );
}

/** A routine run opens with the routine's instructions: folded, so what the agent told stands out. */
function RoutinePrompt({ name, text }: { name: string; text: string }) {
  const t = useT();
  return (
    <details className="transcript__routine">
      <summary>
        <Icons.Clock size={13} />
        <span>{t("thread.routinePrompt", { name })}</span>
        <Icons.ChevronRight size={13} className="transcript__routinechev" />
      </summary>
      <p className="transcript__routinetext">{text}</p>
    </details>
  );
}

/** What the owner attached to a message: images as thumbnails, other files as named chips. */
function UserFiles({ message }: { message: Msg }) {
  const files = message.parts.filter((p) => p.type === "image" || p.type === "file" || p.type === "audio");
  if (!files.length) return null;
  return (
    <div className="transcript__files">
      {files.map((p) =>
        p.type === "image" ? (
          <ImagePart key={p.media_id ?? p.url} part={p} />
        ) : p.type === "file" ? (
          <FilePart key={p.media_id} part={p} />
        ) : p.type === "audio" ? (
          <AudioPart key={p.media_id} part={p} />
        ) : null,
      )}
    </div>
  );
}

function textOf(m: Msg): string {
  const text = m.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n\n");
  return m.parts.some((p) => p.type === "audio") ? text.replace(/\[voice note\]\s*/g, "") : text;
}

/**
 * The owner's (or a contact's) words as written; a leading "> " quote shows as the quote they answer, and leads back
 * to the message it was taken from when that one is still in the chat.
 */
function UserText({ text, sourceOf }: { text: string; sourceOf: (quote: string) => string | undefined }) {
  const t = useT();
  const { quote, rest } = splitQuote(text);
  const source = quote ? sourceOf(quote) : undefined;
  const { author, text: words } = quoteParts(quote);
  const body = (
    <>
      {author && <span className="transcript__quoteauthor">{author}</span>}
      <span className="transcript__quotetext">{words}</span>
    </>
  );
  return (
    <>
      {quote &&
        (source ? (
          <button
            type="button"
            className="transcript__quote is-link"
            title={t("msg.quoteJump")}
            onClick={() => nav.set({ focus: `msg:${source}` })}
          >
            {body}
          </button>
        ) : (
          <blockquote className="transcript__quote">{body}</blockquote>
        ))}
      {rest && <p className="transcript__usertext">{withMentions(rest)}</p>}
    </>
  );
}
