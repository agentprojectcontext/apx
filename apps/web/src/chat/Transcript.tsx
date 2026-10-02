import type { Message as Msg, Thread } from "@apx/protocol";
import { ActivityPill, AgentAvatar, DayDivider, EmptyState, Icons, Message, SystemNote } from "@apx/ui";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { dayLabel, sameDay } from "../common/format.ts";
import { blobOf, isWorking, threadAgent } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useLanguage, useT } from "../i18n/index.ts";
import { useNav } from "../shell/nav.ts";
import { AgentTurn } from "./AgentTurn.tsx";
import { FilePart } from "./parts/FilePart.tsx";
import { ImagePart } from "./parts/ImagePart.tsx";
import { NoticePart } from "./parts/NoticePart.tsx";

const EMPTY: Msg[] = [];
/** Distance from the bottom (px) under which new content keeps the view pinned to the end. */
const STICK_PX = 120;

export function Transcript({ thread }: { thread: Thread }) {
  const t = useT();
  const lang = useLanguage();
  const messages = useData((s) => s.messages[thread.id] ?? EMPTY);
  const agents = useData((s) => s.agents);
  const showTools = useNav((s) => s.tools);
  const agent = threadAgent(thread, agents);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const multiAgent = thread.kind === "a2a" || thread.agent_ids.length > 1;

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

  const onScroll = () => {
    const el = scroller.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
  };

  const working = isWorking(thread.state);
  return (
    <div className="chat__scroll" ref={scroller} onScroll={onScroll}>
      <div className="transcript" ref={content}>
        {rows.length === 0 && !working && (
          <EmptyState icon={<Icons.MessageCircle />} title={t("chat.with", { name: agent?.name ?? thread.title })}>
            {t("chat.startHint")}
          </EmptyState>
        )}
        {rows.map(({ key, day, msg }) => (
          <div key={key} className="transcript__row">
            {day && <DayDivider label={day} />}
            {msg.author.kind === "user" ? (
              <Message from="user" className={msg.id.startsWith("local_") ? "is-pending" : undefined}>
                <p className="transcript__usertext">{textOf(msg)}</p>
                <UserFiles message={msg} />
              </Message>
            ) : msg.author.kind === "system" ? (
              <SystemMessage message={msg} />
            ) : msg.author.kind === "person" ? (
              <Message
                from="agent"
                variant="bubble"
                avatar={<AgentAvatar name={msg.author.name} size={24} />}
                meta={<span className="transcript__person">{msg.author.name}</span>}
              >
                <p className="transcript__usertext">{textOf(msg)}</p>
              </Message>
            ) : msg.author.kind === "surface" ? (
              <SystemNote icon={<Icons.LayoutGrid size={12} />} className="transcript__fromsurface">
                {t("chat.fromWidget")} <b>{msg.author.title}</b>: {textOf(msg)}
              </SystemNote>
            ) : (
              <AgentTurn message={msg} agent={agents[msg.author.id]} showAvatar={multiAgent} showTools={showTools} />
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

/** What the owner attached to a message: images as thumbnails, other files as named chips. */
function UserFiles({ message }: { message: Msg }) {
  const files = message.parts.filter((p) => p.type === "image" || p.type === "file");
  if (!files.length) return null;
  return (
    <div className="transcript__files">
      {files.map((p) =>
        p.type === "image" ? (
          <ImagePart key={p.media_id ?? p.url} part={p} />
        ) : p.type === "file" ? (
          <FilePart key={p.media_id} part={p} />
        ) : null,
      )}
    </div>
  );
}

function textOf(m: Msg): string {
  return m.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n\n");
}
