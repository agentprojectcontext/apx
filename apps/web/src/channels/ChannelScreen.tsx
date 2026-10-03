import type { ChannelInfo, Person, Thread } from "@apx/protocol";
import { EmptyState, IconButton, Icons, ProjectTile, SearchField } from "@apx/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChatView } from "../chat/ChatView.tsx";
import { shortWhen } from "../common/format.ts";
import { loadChannels, useChannels } from "../data/channels.ts";
import { useData } from "../data/state.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { go, nav, useNav } from "../shell/nav.ts";
import { ChannelConversation } from "./ChannelConversation.tsx";
import { ContactPanel } from "./ContactPanel.tsx";
import { KindTile } from "./KindIcon.tsx";
import { isChannelKind } from "./kinds.ts";
import { LinkMe, LinkPhone, OwnerRow, ownerOn, PairingRow } from "./StartRows.tsx";

export const RELATION_KEY: Record<NonNullable<Person["relation"]>, MessageKey> = {
  partner: "ch.rel.partner",
  family: "ch.rel.family",
  friend: "ch.rel.friend",
  coworker: "ch.rel.coworker",
  client: "ch.rel.client",
  associate: "ch.rel.associate",
  provider: "ch.rel.provider",
  other: "ch.rel.other",
};

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

type Row = { thread: Thread; person: Person | undefined };

/**
 * A channel with its contacts built in: who wrote (unread first, silenced last), the chat with the one picked, and
 * their card (who they are, rules for answering them, what their chat may do). The same layout serves every channel.
 */
export function ChannelScreen() {
  const t = useT();
  const channelId = useNav((s) => s.channelId);
  const picked = useNav((s) => s.channelThread);
  const channels = useChannels((s) => s.channels);
  const persons = useChannels((s) => s.persons);
  const pairing = useChannels((s) => s.pairing);
  const threads = useData((s) => s.threads);
  const agents = useData((s) => s.agents);
  const [query, setQuery] = useState("");
  // The card sits beside the chat on wide screens; on narrow ones it covers it, so it starts closed there.
  const [card, setCard] = useState(() => window.innerWidth >= 1280);
  // Someone new may write while this list is open: it is read again every few seconds, as the settings do.
  useEffect(() => {
    void loadChannels();
    const id = setInterval(() => void loadChannels(), 5000);
    return () => clearInterval(id);
  }, []);
  const channel = channels.find((c) => c.id === channelId);

  const rows: Row[] = useMemo(() => {
    const byId = new Map(persons.map((p) => [p.id, p]));
    return Object.values(threads)
      .filter((th) => {
        const pid = th.channel?.id === channelId ? th.channel?.person_id : undefined;
        return Boolean(pid) && byId.get(pid ?? "")?.role !== "owner";
      })
      .map((th) => ({ thread: th, person: byId.get(th.channel?.person_id ?? "") }))
      .sort(
        (a, b) =>
          Number(a.person?.muted ?? false) - Number(b.person?.muted ?? false) ||
          b.thread.updated_at.localeCompare(a.thread.updated_at),
      );
  }, [threads, persons, channelId]);
  // A chat with someone not in the list yet (a contact just approved): fetch the contacts again, once per person.
  const asked = useRef(new Set<string>());
  useEffect(() => {
    const unknown = rows.flatMap((r) => (r.person ? [] : [r.thread.channel?.person_id ?? ""]));
    if (!unknown.some((id) => id && !asked.current.has(id))) return;
    for (const id of unknown) asked.current.add(id);
    void loadChannels();
  }, [rows]);
  const shown = rows.filter(
    (r) =>
      !query ||
      `${r.person?.name ?? r.thread.title} ${r.person?.nickname ?? ""}`.toLowerCase().includes(query.toLowerCase()),
  );
  const current = rows.find((r) => r.thread.id === picked);
  const waiting = pairing.filter((r) => r.channel === channelId);
  const linked = ownerOn(persons, channelId ?? "");
  const ownThread = useMemo(() => {
    const owner = persons.find((p) => p.role === "owner")?.id;
    return Object.values(threads).find((th) => th.channel?.id === channelId && th.channel?.person_id === owner)?.id;
  }, [threads, persons, channelId]);
  // The owner's own chat on this channel: Home (one conversation everywhere) or this channel's chat of theirs.
  const ownerTarget = channel?.owner_thread === "home" ? "home" : ownThread;
  const ownerOpen = linked && Boolean(picked) && picked === ownerTarget;

  if (!channel)
    return (
      <section className="chan chan--empty">
        <EmptyState variant="dashed" size="lg" icon={<Icons.Send />} title={t("ch.none.title")}>
          {t("ch.none.body")}
        </EmptyState>
      </section>
    );

  return (
    <section
      className={`chan${current || ownerOpen ? " has-chat" : ""}${current && card && !ownerOpen ? " has-card" : ""}`}
      aria-label={channel.label}
    >
      <aside className="chan__list">
        <ChannelHead channel={channel} />
        <SearchField
          aria-label={t("ch.search")}
          placeholder={t("ch.search")}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
        <ul className="chan__rows">
          {!query && !linked && channel.type === "telegram" && <LinkMe channel={channel} />}
          {!query && !linked && channel.type === "whatsapp" && !channel.self_owner && <LinkPhone channel={channel} />}
          {!query && waiting.map((r) => <PairingRow key={r.code} request={r} />)}
          {!query && linked && <OwnerRow channel={channel} target={ownerTarget} selected={ownerOpen} />}
          {shown.map((r) => (
            <ContactRow
              key={r.thread.id}
              row={r}
              selected={r.thread.id === picked}
              onPick={() => go.channel(channel.id, r.thread.id)}
            />
          ))}
          {query && !shown.length && <li className="chan__nobody">{t("res.noMatch")}</li>}
        </ul>
        <p className="chan__foot">{t("ch.foot", { agent: agents[channel.agent_id]?.name ?? channel.agent_id })}</p>
      </aside>
      {ownerOpen && ownerTarget ? (
        <OwnerChat threadId={ownerTarget} />
      ) : current ? (
        <>
          <ChannelConversation
            thread={current.thread}
            person={current.person}
            channel={channel}
            card={card}
            onToggleCard={() => setCard((c) => !c)}
            onBack={() => go.channel(channel.id, undefined)}
          />
          {card && current.person && (
            <ContactPanel key={current.person.id} person={current.person} onClose={() => setCard(false)} />
          )}
        </>
      ) : (
        <div className="chan__pick">
          <EmptyState variant="dashed" icon={<Icons.MessageCircle />} title={t("ch.pick.title")}>
            {t("ch.pick.body")}
          </EmptyState>
        </div>
      )}
    </section>
  );
}

/** The owner's chat, opened right here (the same chat as in the Inbox), so the channel stays in view. */
function OwnerChat({ threadId }: { threadId: string }) {
  const shown = useNav((s) => s.threadId);
  useEffect(() => {
    if (shown !== threadId) nav.set({ threadId });
  }, [shown, threadId]);
  return (
    <div className="chan__owner">
      <ChatView wideHeader={false} />
    </div>
  );
}

function ChannelHead({ channel }: { channel: ChannelInfo }) {
  const t = useT();
  const agents = useData((s) => s.agents);
  return (
    <header className="chan__head">
      {isChannelKind(channel.type) ? (
        <KindTile kind={channel.type} size={32} />
      ) : (
        <ProjectTile tone="info" icon={<Icons.Send />} size={32} />
      )}
      <div className="chan__titles">
        <div className="chan__name">{channel.label}</div>
        <div className="chan__meta">
          <span className={`chan__status is-${channel.status}`} />
          {channel.account ? `${channel.account} · ` : ""}
          {t("ch.answers", { agent: agents[channel.agent_id]?.name ?? channel.agent_id })}
        </div>
      </div>
      <IconButton
        size="sm"
        label={t("ch.settings")}
        icon={<Icons.Settings size={14} />}
        onClick={() => go.channelConfig(isChannelKind(channel.type) ? channel.type : "telegram")}
      />
    </header>
  );
}

function ContactRow({ row, selected, onPick }: { row: Row; selected: boolean; onPick(): void }) {
  const t = useT();
  const { thread, person } = row;
  const name = person?.name ?? thread.title;
  const relation = person?.relation ? t(RELATION_KEY[person.relation]) : undefined;
  return (
    <li>
      <button
        type="button"
        className={`chan__row${selected ? " is-selected" : ""}${person?.muted ? " is-muted" : ""}${thread.unread ? " is-unread" : ""}`}
        aria-current={selected || undefined}
        onClick={onPick}
      >
        <span className="chan__avatar">{initials(name)}</span>
        <span className="chan__rowmain">
          <span className="chan__rowtop">
            <span className="chan__rowname">{name}</span>
            <span className="chan__rowtime">{shortWhen(thread.updated_at)}</span>
          </span>
          <span className="chan__rowtop">
            <span className="chan__preview">{thread.preview}</span>
            {thread.unread > 0 && <span className="chan__unread">{thread.unread}</span>}
          </span>
          <span className="chan__rel">
            {[relation, person?.muted ? t("ch.muted") : undefined].filter(Boolean).join(" · ")}
          </span>
        </span>
      </button>
    </li>
  );
}
