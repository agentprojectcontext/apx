import type { ChannelInfo, Message, Person, Thread } from "@apx/protocol";
import { Button, EmptyState, IconButton, Icons, SegmentedControl, Skeleton, StickyScroll, Textarea } from "@apx/ui";
import { Suspense, useEffect, useState } from "react";
import { FilePart } from "../chat/parts/FilePart.tsx";
import { AudioPart } from "../chat/parts/lazyAudio.tsx";
import { bubbleFiles, mediaBlocks, withoutFilesNote } from "../chat/parts/mediaGroups.ts";
import { shortWhen } from "../common/format.ts";
import { loadThread, markRead, send } from "../data/actions.ts";
import { openContactChat, type PresenceState, recoverFiles, sendDirect } from "../data/channels.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { MediaGroup } from "../lazy.ts";
import { go } from "../shell/nav.ts";
import { addressText, ContactFace } from "./ContactRow.tsx";
import { DeliveryTicks, ReactionList } from "./MessageMarks.tsx";
import { RELATION_KEY } from "./people.ts";
import { isSignal } from "./signal.ts";

/** What a file that never arrived left in its message (the core asks for it again: channels.recover). */
const LOST_FILE =
  /\[(?:(?:photo|video|file|sticker) — APX cannot read this kind of message yet|attachment could not be downloaded: [^\]\n]*)\]/;

/**
 * The chat with one contact. Their words on the left; what was sent to them (by the agent or by the owner) on the
 * right, with how far it got; what the agent did (a request it passed on) as a quiet note in the middle. Below, the
 * owner picks: tell the agent what to answer, or write to them directly. A saved contact with no chat yet shows an
 * empty one: the first words make it.
 */
export function ChannelConversation(props: {
  thread: Thread | undefined;
  person: Person | undefined;
  presence: PresenceState | undefined;
  channel: ChannelInfo;
  card: boolean;
  onToggleCard(): void;
  onBack(): void;
}) {
  const t = useT();
  const { thread, person, channel } = props;
  const threadId = thread?.id ?? "";
  const messages = useData((s) => s.messages[threadId]);
  const load = useData((s) => s.threadLoad[threadId]);
  const agent = useData((s) => s.agents[channel.agent_id]);
  const [mode, setMode] = useState("agent");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const name = person?.name ?? thread?.title ?? "";
  const agentName = agent?.name ?? channel.agent_id;

  useEffect(() => {
    if (threadId && load == null) void loadThread(threadId);
  }, [load, threadId]);
  useEffect(() => {
    if (thread && thread.unread > 0 && load === "ready") void markRead(thread.id);
  }, [thread, load]);
  const count = messages?.length ?? 0;

  const submit = async () => {
    const words = text.trim();
    if (!words) return;
    setBusy(true);
    let id = thread?.id;
    // A contact with no chat yet: it is made now, and the list picks it.
    if (!id && person) {
      id = (await openContactChat(person.id, channel.id))?.id;
      if (id) go.channel(channel.id, id);
    }
    let ok = Boolean(id);
    if (id && mode === "me") ok = await sendDirect(id, words);
    else if (id) await send(id, words);
    setBusy(false);
    if (ok) setText("");
    if (id && mode === "me") void loadThread(id);
  };
  const empty = !thread || (load === "ready" && !count);
  const first = empty && mode === "agent";
  const writeLabel =
    mode === "me"
      ? t("ch.writeMe", { name })
      : t(first ? "ch.writeAgentFirst" : "ch.writeAgent", { agent: agentName, name });
  const hint =
    mode === "me"
      ? t("ch.hint.me", { name })
      : t(first ? "ch.hint.agentFirst" : "ch.hint.agent", { agent: agentName, name });
  const meta = [
    props.presence?.online
      ? t("ch.online")
      : props.presence?.last_seen
        ? t("ch.lastSeen", { when: shortWhen(props.presence.last_seen) })
        : undefined,
    person?.nickname,
    person?.relation ? t(RELATION_KEY[person.relation]) : undefined,
  ].filter(Boolean);
  const address = addressText(channel.type, person, channel.id);
  // Only WhatsApp can send old messages again (the owner's phone keeps them).
  const lostFiles =
    channel.type === "whatsapp" &&
    (messages ?? []).some(
      (m) =>
        m.author.kind === "person" &&
        !m.parts.some((p) => p.type === "file" || p.type === "image") &&
        m.parts.some((p) => p.type === "text" && LOST_FILE.test(p.text)),
    );
  const recover = async () => {
    setRecovering(true);
    await recoverFiles(threadId);
    setRecovering(false);
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
        <button
          type="button"
          className="chan__who"
          aria-label={t("ch.openContact", { name })}
          aria-expanded={props.card}
          onClick={props.onToggleCard}
        >
          <ContactFace person={person} name={name} presence={props.presence} />
          <span className="chan__titles">
            <span className="chan__name">{name}</span>
            <span className="chan__meta">{meta.join(" · ")}</span>
          </span>
        </button>
        {lostFiles && (
          <Button
            size="sm"
            variant="ghost"
            title={t("ch.recover.hint")}
            leadingIcon={<Icons.Download size={14} />}
            disabled={recovering}
            onClick={() => void recover()}
          >
            {t("ch.recover")}
          </Button>
        )}
        <Button
          size="sm"
          variant={props.card ? "secondary" : "ghost"}
          leadingIcon={<Icons.User size={14} />}
          onClick={props.onToggleCard}
        >
          {t("ch.contact")}
        </Button>
      </header>
      <StickyScroll
        resetKey={threadId || (person?.id ?? "")}
        toBottomLabel={t("chat.toBottom")}
        className="chan__msgs"
        contentClassName="chan__msglist"
      >
        {empty ? (
          <div className="chan__pick">
            <EmptyState variant="dashed" icon={<Icons.MessageCircle />} title={t("ch.empty.title", { name })}>
              {[address, t("ch.empty.body", { agent: agentName, name })].filter(Boolean).join(" · ")}
            </EmptyState>
          </div>
        ) : load !== "ready" && !messages ? (
          <Skeleton height={120} />
        ) : (
          (messages ?? []).map((m) => <Bubble key={m.id} m={m} agentName={agentName} />)
        )}
      </StickyScroll>
      <div className="chan__composer">
        <Textarea
          aria-label={writeLabel}
          placeholder={writeLabel}
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
        <p className="chan__hint">{hint}</p>
      </div>
    </section>
  );
}

function Bubble({ m, agentName }: { m: Message; agentName: string }) {
  const t = useT();
  const said = m.parts
    .flatMap((p) => (p.type === "text" ? [p.text] : []))
    .join("\n")
    .trim();
  const words = m.author.kind === "agent" && isSignal(said) ? "" : withoutFilesNote(m.parts, said);
  const media = mediaBlocks(m.parts).filter((b) => b.kind !== "part");
  const files = bubbleFiles(m.parts);
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
      {(words || media.length > 0 || files.length > 0) && (
        <div className={`chan__bubble${out ? " is-out" : ""}${instruction ? " is-instruction" : ""}`}>
          {media.length > 0 && (
            <Suspense fallback={<Skeleton height={160} />}>
              {media.map((b) => (
                <MediaGroup key={b.key} block={b} />
              ))}
            </Suspense>
          )}
          {files.map((p) =>
            p.type === "file" ? <FilePart key={p.media_id} part={p} /> : <AudioPart key={p.media_id} part={p} />,
          )}
          {words && <p className="chan__text">{words}</p>}
          {m.reactions?.length ? (
            <span className="chan__reactions">
              <ReactionList list={m.reactions} agentName={agentName} />
            </span>
          ) : null}
          <span className="chan__when">
            {[who, shortWhen(m.created_at)].filter(Boolean).join(" · ")}
            {out && !instruction && m.delivery && <DeliveryTicks state={m.delivery} />}
          </span>
        </div>
      )}
    </>
  );
}
