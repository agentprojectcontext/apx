import type { ChannelInfo, Message, Person, Thread } from "@apx/protocol";
import { Button, IconButton, Icons, SegmentedControl, Skeleton, Textarea } from "@apx/ui";
import { useEffect, useRef, useState } from "react";
import { shortWhen } from "../common/format.ts";
import { loadThread, markRead, send } from "../data/actions.ts";
import { sendDirect } from "../data/channels.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { initials, RELATION_KEY } from "./ChannelScreen.tsx";

/**
 * The chat with one contact. Their words on the left; what was sent to them (by the agent or by the owner) on the
 * right; what the agent did (a request it passed on) as a quiet note in the middle. Below, the owner picks: tell the
 * agent what to answer, or write to them directly.
 */
export function ChannelConversation(props: {
  thread: Thread;
  person: Person | undefined;
  channel: ChannelInfo;
  card: boolean;
  onToggleCard(): void;
  onBack(): void;
}) {
  const t = useT();
  const { thread, person, channel } = props;
  const messages = useData((s) => s.messages[thread.id]);
  const load = useData((s) => s.threadLoad[thread.id]);
  const agent = useData((s) => s.agents[channel.agent_id]);
  const [mode, setMode] = useState("agent");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const name = person?.name ?? thread.title;
  const agentName = agent?.name ?? channel.agent_id;

  useEffect(() => {
    if (load == null) void loadThread(thread.id);
  }, [load, thread.id]);
  useEffect(() => {
    if (thread.unread > 0 && load === "ready") void markRead(thread.id);
  }, [thread.id, thread.unread, load]);
  const count = messages?.length ?? 0;
  useEffect(() => {
    if (count) end.current?.scrollIntoView({ block: "end" });
  }, [count]);

  const submit = async () => {
    const words = text.trim();
    if (!words) return;
    setBusy(true);
    let ok = true;
    if (mode === "me") ok = await sendDirect(thread.id, words);
    else await send(thread.id, words);
    setBusy(false);
    if (ok) setText("");
    if (mode === "me") void loadThread(thread.id);
  };

  return (
    <section className="chan__chat" aria-label={name}>
      <header className="chan__chathead">
        <IconButton
          size="sm"
          className="chan__back"
          label={t("ch.back")}
          icon={<Icons.ArrowLeft size={14} />}
          onClick={props.onBack}
        />
        <span className="chan__avatar">{initials(name)}</span>
        <div className="chan__titles">
          <div className="chan__name">{name}</div>
          <div className="chan__meta">
            {[person?.nickname, person?.relation ? t(RELATION_KEY[person.relation]) : undefined]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        <Button
          size="sm"
          variant={props.card ? "secondary" : "ghost"}
          leadingIcon={<Icons.User size={14} />}
          onClick={props.onToggleCard}
        >
          {t("ch.contact")}
        </Button>
      </header>
      <div className="chan__msgs">
        {load !== "ready" && !messages ? (
          <Skeleton height={120} />
        ) : (
          (messages ?? []).map((m) => <Bubble key={m.id} m={m} agentName={agentName} />)
        )}
        <div ref={end} />
      </div>
      <div className="chan__composer">
        <Textarea
          aria-label={mode === "me" ? t("ch.writeMe", { name }) : t("ch.writeAgent", { agent: agentName, name })}
          placeholder={mode === "me" ? t("ch.writeMe", { name }) : t("ch.writeAgent", { agent: agentName, name })}
          rows={2}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <div className="chan__composerbar">
          <SegmentedControl
            size="sm"
            label={t("ch.who")}
            value={mode}
            onValueChange={setMode}
            options={[
              { value: "agent", label: t("ch.agentAnswers", { agent: agentName }) },
              { value: "me", label: t("ch.iWrite") },
            ]}
          />
          <span className="chan__spacer" />
          <IconButton
            variant="primary"
            shape="circle"
            label={t("tasks.send")}
            icon={<Icons.ArrowUp size={14} />}
            disabled={!text.trim() || busy}
            onClick={() => void submit()}
          />
        </div>
        <p className="chan__hint">
          {mode === "me" ? t("ch.hint.me", { name }) : t("ch.hint.agent", { agent: agentName, name })}
        </p>
      </div>
    </section>
  );
}

function Bubble({ m, agentName }: { m: Message; agentName: string }) {
  const t = useT();
  const words = m.parts
    .flatMap((p) => (p.type === "text" ? [p.text] : []))
    .join("\n")
    .trim();
  const actions = m.parts.flatMap((p) => (p.type === "tool" && p.status !== "error" ? [p.title] : []));
  const out = m.author.kind === "agent" || m.author.kind === "user";
  // The owner's words to the agent (what to answer) read apart from what was sent to the contact.
  const instruction = m.author.kind === "user" && !m.author.direct;
  const who =
    m.author.kind === "agent"
      ? agentName
      : instruction
        ? t("ch.youToAgent", { agent: agentName })
        : m.author.kind === "user"
          ? t("ch.you")
          : undefined;
  return (
    <>
      {actions.map((a) => (
        <p key={a} className="chan__note">
          <Icons.Bot size={12} /> {t("ch.agentDid", { agent: agentName, what: a })}
        </p>
      ))}
      {words && (
        <div className={`chan__bubble${out ? " is-out" : ""}${instruction ? " is-instruction" : ""}`}>
          <p className="chan__text">{words}</p>
          <span className="chan__when">{[who, shortWhen(m.created_at)].filter(Boolean).join(" · ")}</span>
        </div>
      )}
    </>
  );
}
