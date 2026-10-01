import type { Message as Msg, Thread } from "@apx/protocol";
import { ActivityPill, AgentAvatar, DayDivider, EmptyState, Icons, Message, SystemNote } from "@apx/ui";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { dayLabel, sameDay } from "../common/format.ts";
import { blobOf, isWorking, threadAgent } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useNav } from "../shell/nav.ts";
import { AgentTurn } from "./AgentTurn.tsx";

const EMPTY: Msg[] = [];
/** Distance from the bottom (px) under which new content keeps the view pinned to the end. */
const STICK_PX = 120;

export function Transcript({ thread }: { thread: Thread }) {
  const messages = useData((s) => s.messages[thread.id] ?? EMPTY);
  const agents = useData((s) => s.agents);
  const showTools = useNav((s) => s.tools);
  const agent = threadAgent(thread, agents);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const multiAgent = thread.kind === "a2a" || thread.agent_ids.length > 1;

  const rows = useMemo(() => {
    const out: { key: string; day?: string; msg: Msg }[] = [];
    let prev: string | undefined;
    for (const m of messages) {
      out.push({ key: m.id, day: !prev || !sameDay(prev, m.created_at) ? dayLabel(m.created_at) : undefined, msg: m });
      prev = m.created_at;
    }
    return out;
  }, [messages]);

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
          <EmptyState icon={<Icons.MessageCircle />} title={`Chat con ${agent?.name ?? thread.title}`}>
            Escribí abajo para empezar.
          </EmptyState>
        )}
        {rows.map(({ key, day, msg }) => (
          <div key={key} className="transcript__row">
            {day && <DayDivider label={day} />}
            {msg.author.kind === "user" ? (
              <Message from="user" className={msg.id.startsWith("local_") ? "is-pending" : undefined}>
                <p className="transcript__usertext">{textOf(msg)}</p>
              </Message>
            ) : msg.author.kind === "system" ? (
              <SystemNote>{textOf(msg)}</SystemNote>
            ) : msg.author.kind === "surface" ? (
              <SystemNote icon={<Icons.LayoutGrid size={12} />} className="transcript__fromsurface">
                Desde el widget <b>{msg.author.title}</b>: {textOf(msg)}
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
              label={`${agent?.name ?? "El agente"} está trabajando…`}
              from={agent && <AgentAvatar name={agent.name} blob={blobOf(agent)} size={22} />}
            />
          </div>
        )}
        {thread.state === "input-required" && (
          <div className="transcript__activity">
            <ActivityPill tone="danger" label={`${agent?.name ?? "El agente"} te espera`} />
          </div>
        )}
      </div>
    </div>
  );
}

function textOf(m: Msg): string {
  return m.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n\n");
}
