import "../styles/screens.css";
import type { Agent, ChannelInfo, RoomMode, Thread } from "@apx/protocol";
import { Button, EmptyState, IconButton, Icons, Menu, ProjectTile, SearchField } from "@apx/ui";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { ChatView } from "../chat/ChatView.tsx";
import { shortWhen } from "../common/format.ts";
import { loadChannels, loadPresence, type PresenceState, useChannels } from "../data/channels.ts";
import { useData } from "../data/state.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { SidePanel } from "../panel/SidePanel.tsx";
import { ListColumn } from "../shell/ListColumn.tsx";
import { LAYOUT } from "../shell/layout.ts";
import { go, nav, useNav } from "../shell/nav.ts";
import { useShellLayout } from "../shell/useShellLayout.ts";
import { AnswersLine } from "./AnswersLine.tsx";
import { accountName, accountWhere } from "./accountName.ts";
import { accountTools } from "./accountTools.tsx";
import { answerersOf, answersLine } from "./answerers.ts";
import { ChannelConversation } from "./ChannelConversation.tsx";
import { ContactPanel } from "./ContactPanel.tsx";
import { ContactRow, type Row } from "./ContactRow.tsx";
import { useAccountCounts } from "./counts.ts";
import { ContactFlags, useAccountFlags } from "./flags.tsx";
import { KindIcon, KindTile } from "./KindIcon.tsx";
import { isChannelKind } from "./kinds.ts";
import { LinkMe, LinkPhone, OwnerRow, ownerOn, PairingRow } from "./StartRows.tsx";

/** A saved contact picked before they have a chat: the list's selection names them instead of a chat. */
const PERSON_PICK = "person:";

/** What a mailbox's list shows: people (the default), everything, or the chats of one kind of marked mail. */
const MAIL_VIEWS = ["people", "all", "automatic", "spam", "unverified", "blocked", "outside"] as const;
type MailView = (typeof MAIL_VIEWS)[number];
const MAIL_VIEW_LABEL: Record<MailView, MessageKey> = {
  people: "ch.mailView.people",
  all: "ch.mailView.all",
  automatic: "ch.mark.automatic",
  spam: "ch.mark.spam",
  unverified: "ch.mark.unverified",
  blocked: "ch.mark.blocked",
  outside: "ch.mark.outside",
};

const ROOM_MODE_KEY: Record<RoomMode, MessageKey> = {
  always: "rooms.mode.always",
  mention: "rooms.mode.mention",
  useful: "rooms.mode.useful",
  read: "rooms.mode.read",
};

/**
 * A channel with its contacts built in: who wrote (unread first, silenced last), the chat with the one picked, and
 * their card (who they are, rules for answering them, what their chat may do). The same layout serves every channel;
 * a server's rooms (Discord) and an account's groups are listed too, each one a shared chat with its own card (when the
 * agent speaks there, the rooms' rules).
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
  const layout = useShellLayout();
  // The list is as wide as the Inbox's, and its edge resizes both; a phone shows one column at a time.
  const listW = layout?.listW || LAYOUT.listW;
  const resizable = Boolean(layout && !layout.compact);
  const [mailView, setMailView] = useState<MailView>("people");
  // The card sits beside the chat on wide screens; on narrow ones it covers it, so it starts closed there.
  const [card, setCard] = useState(() => window.innerWidth >= 1280);
  // Someone new may write while this list is open: it is read again every few seconds, as the settings do.
  useEffect(() => {
    void loadChannels();
    const id = setInterval(() => void loadChannels(), 5000);
    return () => clearInterval(id);
  }, []);
  const channel = channels.find((c) => c.id === channelId);
  // WhatsApp says who is online to a device that asks; it is asked again with the list.
  const [presence, setPresence] = useState<Record<string, PresenceState>>({});
  const watchPresence = channel?.type === "whatsapp" && channel.status === "running";
  useEffect(() => {
    setPresence({});
    if (!watchPresence || !channelId) return;
    let live = true;
    const ask = () => void loadPresence(channelId).then((p) => live && setPresence(p));
    ask();
    const id = setInterval(ask, 5000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [watchPresence, channelId]);

  const rows: Row[] = useMemo(() => {
    const byId = new Map(persons.map((p) => [p.id, p]));
    const chats = Object.values(threads)
      .filter((th) => {
        const pid = th.channel?.id === channelId ? th.channel?.person_id : undefined;
        return Boolean(pid) && byId.get(pid ?? "")?.role !== "owner";
      })
      .map((th) => ({ key: th.id, thread: th, person: byId.get(th.channel?.person_id ?? "") }))
      .sort(
        (a, b) =>
          Number(a.person?.muted ?? false) - Number(b.person?.muted ?? false) ||
          b.thread.updated_at.localeCompare(a.thread.updated_at),
      );
    // Saved contacts reachable here who have no chat yet go after the chats, by name.
    const talked = new Set(chats.map((r) => r.person?.id));
    const others = persons
      .filter((p) => p.role === "contact" && !talked.has(p.id) && p.addresses.some((a) => a.channel === channelId))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({ key: `${PERSON_PICK}${p.id}`, person: p }));
    return [...chats, ...others];
  }, [threads, persons, channelId]);
  // A chat with someone not in the list yet (a contact just approved): fetch the contacts again, once per person.
  const asked = useRef(new Set<string>());
  useEffect(() => {
    const unknown = rows.flatMap((r) => (r.person ? [] : [r.thread?.channel?.person_id ?? ""]));
    if (!unknown.some((id) => id && !asked.current.has(id))) return;
    for (const id of unknown) asked.current.add(id);
    void loadChannels();
  }, [rows]);
  // A mailbox lists people by default; the filter shows the chats of marked mail (spam, automatic…) too, or one kind.
  const mailbox = channel?.type === "email";
  const marked = mailbox ? rows.filter((r) => r.thread?.mail_mark).length : 0;
  const inView = (r: Row) =>
    !mailbox || mailView === "all" || (mailView === "people" ? !r.thread?.mail_mark : r.thread?.mail_mark === mailView);
  const shown = rows.filter(
    (r) =>
      inView(r) &&
      (!query ||
        `${r.person?.name ?? r.thread?.title ?? ""} ${r.person?.nickname ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  // A room's chat is the one chat with no person behind it: everyone there writes into it.
  const rooms = useMemo(
    () =>
      Object.values(threads)
        .filter((th) => th.channel?.id === channelId && !th.channel?.person_id)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [threads, channelId],
  );
  const shownRooms = rooms.filter((th) => !query || th.title.toLowerCase().includes(query.toLowerCase()));
  const room = picked ? rooms.find((th) => th.id === picked) : undefined;
  const roomOpen = Boolean(room);
  const current = rows.find((r) => r.key === picked);
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

  const list = (
    <aside className="chan__list">
      <ChannelHead channel={channel} />
      <div className="chan__find">
        <SearchField
          aria-label={t("ch.search")}
          placeholder={t("ch.search")}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
        {mailbox && (
          <Menu
            align="end"
            items={[
              { type: "label" as const, label: t("ch.mailView") },
              ...MAIL_VIEWS.flatMap((v) => [
                // The marks come after a heading of their own: each shows only the chats of that kind of mail.
                ...(v === "automatic" ? [{ type: "label" as const, label: t("ch.mailView.marked") }] : []),
                { label: t(MAIL_VIEW_LABEL[v]), checked: mailView === v, onSelect: () => setMailView(v) },
              ]),
            ]}
            trigger={
              <IconButton
                size="sm"
                variant={mailView === "people" ? "ghost" : "secondary"}
                label={t("ch.mailView")}
                icon={<Icons.Filter size={14} />}
              />
            }
          />
        )}
      </div>
      <ul className="chan__rows">
        {!query && !linked && channel.type === "telegram" && <LinkMe channel={channel} />}
        {!query && !linked && channel.type === "whatsapp" && !channel.self_owner && <LinkPhone channel={channel} />}
        {!query && waiting.map((r) => <PairingRow key={r.code} request={r} />)}
        {!query && linked && (channel.type !== "email" || ownerTarget) && (
          <OwnerRow channel={channel} target={ownerTarget} selected={ownerOpen} />
        )}
        {shownRooms.map((th) => (
          <RoomRow
            key={th.id}
            thread={th}
            channel={channel}
            agent={agents[th.agent_ids[0] ?? ""]}
            selected={th.id === picked}
            onPick={() => go.channel(channel.id, th.id)}
          />
        ))}
        {shown.map((r) => (
          <ContactRow
            key={r.key}
            row={r}
            type={channel.type}
            channelId={channel.id}
            presence={r.person ? presence[r.person.id] : undefined}
            agent={
              agents[r.thread?.agent_ids[0] ?? r.person?.agent_id ?? channel.contacts_agent_id ?? channel.agent_id]
            }
            selected={r.key === picked}
            onPick={() => go.channel(channel.id, r.key)}
          />
        ))}
        {query && !shown.length && !shownRooms.length && <li className="chan__nobody">{t("res.noMatch")}</li>}
        {!query && mailView === "people" && marked > 0 && (
          <li>
            <Button variant="link" size="sm" className="chan__hidden" onClick={() => setMailView("all")}>
              {t("ch.mailHidden", { n: marked })}
            </Button>
          </li>
        )}
      </ul>
    </aside>
  );

  return (
    <section
      className={`chan${current || ownerOpen || roomOpen ? " has-chat" : ""}${current && !room && card && !ownerOpen ? " has-card" : ""}`}
      style={{ "--chan-list-w": `${listW}px` } as CSSProperties}
      aria-label={channel.label}
    >
      {resizable ? <ListColumn width={listW}>{list}</ListColumn> : list}
      {ownerOpen && ownerTarget ? (
        <OpenChat
          threadId={ownerTarget}
          {...(ownerTarget === "home" ? { via: { channel: channel.id, label: channel.label } } : {})}
        />
      ) : room ? (
        <OpenChat threadId={room.id} />
      ) : current ? (
        <>
          <ChannelConversation
            key={`chat:${current.person?.id ?? current.key}`}
            thread={current.thread}
            person={current.person}
            presence={current.person ? presence[current.person.id] : undefined}
            channel={channel}
            card={card}
            onToggleCard={() => setCard((c) => !c)}
            onBack={() => go.channel(channel.id, undefined)}
          />
          {card && current.person && (
            <ContactPanel
              key={current.person.id}
              person={current.person}
              channel={channel}
              onClose={() => setCard(false)}
            />
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

/**
 * The owner's chat or a room's, opened right here (the same chat as in the Inbox), so the channel stays in view. Home
 * shows only this channel's part of it (`via`); all of it is in Home itself.
 */
function OpenChat({ threadId, via }: { threadId: string; via?: { channel: string; label: string } }) {
  const shown = useNav((s) => s.threadId);
  const panel = useNav((s) => s.panel);
  useEffect(() => {
    if (shown !== threadId) nav.set({ threadId });
  }, [shown, threadId]);
  return (
    <div className="chan__owner">
      <ChatView wideHeader={false} {...(via ? { via } : {})} />
      {panel != null && <SidePanel />}
    </div>
  );
}

/** The account on top: its app, name and who answers; the name switches to another account, beside contacts and settings. */
function ChannelHead({ channel }: { channel: ChannelInfo }) {
  const t = useT();
  const agents = useData((s) => s.agents);
  const channels = useChannels((s) => s.channels);
  const counts = useAccountCounts();
  const kind = isChannelKind(channel.type) ? channel.type : undefined;
  const answerers = answerersOf(channel, agents);
  const name = accountName(channel, t);
  const flags = useAccountFlags(channel);
  const tools = accountTools(channel, t);
  return (
    <header className="chan__head">
      <Menu
        align="start"
        trigger={
          // ui: the menu opens from the account's mark, name and line together, which no kit button holds.
          <button type="button" className="chan__switch">
            {kind ? <KindTile kind={kind} size={26} /> : <ProjectTile tone="info" icon={<Icons.Send />} size={26} />}
            <span className="chan__titles">
              <span className="chan__name">
                <span className="chan__nametext">{name}</span>
                <Icons.ChevronDown size={14} />
              </span>
              <span className="chan__meta">
                {/* Only an account that is not up says so here; its number and details are in its settings. */}
                {channel.status !== "running" && <span className={`chan__status is-${channel.status}`} />}
                <AnswersLine
                  className="chan__metatext"
                  lead={[accountWhere(channel, name)]}
                  agent={answerers.owner}
                  text={answersLine(answerers, t)}
                />
                <ContactFlags flags={flags} />
              </span>
            </span>
          </button>
        }
        items={[
          ...tools.map((tool) => ({ label: tool.label, icon: tool.icon, onSelect: tool.onSelect })),
          ...(tools.length ? [{ type: "separator" as const }] : []),
          { type: "label" as const, label: t("chs.accounts") },
          ...channels.map((c) => {
            const n = (counts.get(c.id)?.unread ?? 0) + (counts.get(c.id)?.waiting ?? 0);
            return {
              label: n ? `${accountName(c, t)} · ${n}` : accountName(c, t),
              icon: isChannelKind(c.type) ? <KindIcon kind={c.type} /> : <Icons.Send />,
              checked: c.id === channel.id,
              onSelect: () => go.channel(c.id),
            };
          }),
          { type: "separator" as const },
          { label: t("nav.manageChannels"), icon: <Icons.LayoutGrid />, onSelect: () => go.view("channels") },
        ]}
      />
      {/* On a phone they are in the account's menu: the name needs the room. */}
      <span className="chan__headtools">
        {tools.map((tool) => (
          <IconButton key={tool.key} size="sm" label={tool.label} icon={tool.icon} onClick={tool.onSelect} />
        ))}
      </span>
    </header>
  );
}

function RoomRow({
  thread,
  channel,
  agent,
  selected,
  onPick,
}: {
  thread: Thread;
  channel: ChannelInfo;
  agent: Agent | undefined;
  selected: boolean;
  onPick(): void;
}) {
  const t = useT();
  const mode = channel.rooms?.rooms.find((r) => r.id === thread.channel?.conversation)?.mode;
  return (
    <li>
      <button
        type="button"
        className={`chan__row${selected ? " is-selected" : ""}${thread.unread ? " is-unread" : ""}`}
        aria-current={selected || undefined}
        onClick={onPick}
      >
        <span className="chan__avatar is-owner">
          <Icons.Hash size={16} />
        </span>
        <span className="chan__rowmain">
          <span className="chan__rowtop">
            <span className="chan__rowname">{thread.title}</span>
            <span className="chan__rowtime">{shortWhen(thread.updated_at)}</span>
          </span>
          <span className="chan__rowtop">
            <span className="chan__preview">{thread.preview}</span>
            {thread.unread > 0 && <span className="chan__unread">{thread.unread}</span>}
          </span>
          <span className="chan__rowtop chan__rowanswer">
            <AnswersLine className="chan__rel" lead={[mode ? t(ROOM_MODE_KEY[mode]) : undefined]} agent={agent} />
          </span>
        </span>
      </button>
    </li>
  );
}
