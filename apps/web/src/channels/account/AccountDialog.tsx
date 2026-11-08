import "../../styles/screens.css";
import type { ChannelInfo } from "@apx/protocol";
import { SUPER_AGENT_ID } from "@apx/protocol/client";
import { Button, Dialog, Icons, Kbd, Menu, NavItem, PickRow } from "@apx/ui";
import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { MOD } from "../../common/modKey.ts";
import { SectionHead } from "../../config/SectionHead.tsx";
import {
  type ChannelDraft,
  draftOf,
  loadChannels,
  newChannelId,
  saveChannel,
  useChannels,
} from "../../data/channels.ts";
import { useData } from "../../data/state.ts";
import { type MessageKey, useT } from "../../i18n/index.ts";
import { LAYOUT } from "../../shell/layout.ts";
import { type AccountEdit, go, type AccountPane as Pane, useNav } from "../../shell/nav.ts";
import { accountLine } from "../accountMenu.tsx";
import { useAccountCounts } from "../counts.ts";
import { KindTile } from "../KindIcon.tsx";
import { CHANNEL_KINDS, isChannelKind } from "../kinds.ts";
import { AccountPane, NewAccountPane } from "./AccountPane.tsx";
import { ActivityPane } from "./ActivityPane.tsx";
import { AnswerPane } from "./AnswerPane.tsx";
import { ApprovalsPane } from "./ApprovalsPane.tsx";
import { BehaviorPane } from "./BehaviorPane.tsx";
import { ContactsPane } from "./ContactsPane.tsx";
import { keptAfter } from "./draft.ts";
import { isRoomsKind, RoomsSection } from "./RoomsPane.tsx";
import { hasStickersPane, StickersPane } from "./StickersPane.tsx";
import type { Create, PaneProps } from "./types.ts";

// The dialog portals outside .shell, so it gets its sizes here instead of the --shell-* variables.
const SIZE = {
  width: `min(${LAYOUT.configW}px, calc(100vw - 64px))`,
  height: `min(${LAYOUT.configH}px, calc(100vh - 64px))`,
  "--config-nav-w": `${LAYOUT.configNavW}px`,
} as CSSProperties;

const GROUPS: { label: MessageKey; panes: { id: Pane; icon: ReactNode }[] }[] = [
  {
    label: "acct.group.general",
    panes: [
      { id: "account", icon: <Icons.Settings /> },
      { id: "answer", icon: <Icons.Bot /> },
      { id: "behavior", icon: <Icons.ListChecks /> },
      { id: "stickers", icon: <Icons.Sparkles /> },
      { id: "rooms", icon: <Icons.Hash /> },
    ],
  },
  {
    label: "acct.group.people",
    panes: [
      { id: "contacts", icon: <Icons.Users /> },
      { id: "approvals", icon: <Icons.Check /> },
    ],
  },
  { label: "acct.group.record", panes: [{ id: "activity", icon: <Icons.Activity /> }] },
];

const LEAD: Record<Pane, MessageKey> = {
  account: "acct.lead.account",
  answer: "acct.lead.answer",
  behavior: "acct.lead.behavior",
  stickers: "acct.lead.stickers",
  rooms: "acct.lead.behavior",
  contacts: "acct.lead.contacts",
  approvals: "acct.lead.approvals",
  activity: "acct.lead.activity",
};

/**
 * A new account's id: iMessage is one per Mac; a mailbox gets an id of its own, as it always did (its signatures are
 * kept by it); the rest are named by `newChannelId`.
 */
const accountId = (kind: keyof typeof CHANNEL_KINDS, channels: readonly { id: string }[]) =>
  kind === "imessage"
    ? "imessage"
    : kind === "email"
      ? `email-${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`
      : newChannelId(kind, channels);

/** "New channel" and an account's settings, whichever is open. */
export function ChannelDialogs() {
  const pick = useNav((s) => s.channelPick);
  const edit = useNav((s) => s.channelEdit);
  return (
    <>
      {pick && <KindPicker />}
      {edit && <AccountDialog key={`${edit.kind}:${edit.id ?? "new"}`} edit={edit} />}
    </>
  );
}

/** The apps to connect, each with how it connects; iMessage, one per Mac, opens its settings when it is on. */
function KindPicker() {
  const t = useT();
  const channels = useChannels((s) => s.channels);
  return (
    <Dialog
      size="lg"
      title={t("chs.new")}
      description={t("chs.pickLead")}
      closeLabel={t("common.close")}
      open
      onOpenChange={(open) => !open && go.closeChannelDialogs()}
    >
      <div className="chpick">
        {(Object.keys(CHANNEL_KINDS) as (keyof typeof CHANNEL_KINDS)[]).map((kind) => (
          <PickRow
            key={kind}
            className="chpick__kind"
            leading={<KindTile kind={kind} size={24} />}
            title={t(CHANNEL_KINDS[kind].name)}
            description={t(`chs.how.${kind}`)}
            onClick={() => {
              const only = kind === "imessage" ? channels.find((c) => c.type === kind) : undefined;
              if (only) go.channelSettings(kind, only.id);
              else go.newChannel(kind);
            }}
          />
        ))}
      </div>
    </Dialog>
  );
}

/** Asks before something that cannot be taken back, or before unsaved edits are lost. */
function Confirm({
  title,
  body,
  yes,
  danger,
  onYes,
  onClose,
}: {
  title: string;
  body: string;
  yes: string;
  danger?: boolean;
  onYes(): void;
  onClose(): void;
}) {
  const t = useT();
  return (
    <Dialog
      open
      size="sm"
      title={title}
      description={body}
      closeLabel={t("common.close")}
      onOpenChange={(open) => !open && onClose()}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onYes}>
            {yes}
          </Button>
        </>
      }
    />
  );
}

/**
 * One account's settings, in parts listed on the left, saved together with Save. A new account starts on its
 * connection; the other parts open once it is connected, and Create channel keeps it.
 */
function AccountDialog({ edit }: { edit: AccountEdit }) {
  const t = useT();
  const channels = useChannels((s) => s.channels);
  const agents = useData((s) => s.agents);
  const counts = useAccountCounts();
  const [newId] = useState(() => accountId(edit.kind, channels));
  const [made, setMade] = useState<string>();
  const [pane, setPane] = useState<Pane>(edit.pane);
  const [edits, setEdits] = useState<Partial<ChannelDraft>>({});
  const [asking, setAsking] = useState<"leave" | "remove">();
  const [leaveTo, setLeaveTo] = useState<() => void>();
  useEffect(() => setPane(edit.pane), [edit.pane]);
  const isNew = !edit.id;
  const id = edit.id ?? made;
  const channel = channels.find((c) => c.id === id);
  const connected = channel?.status === "running";
  // While a QR waits it changes every few seconds: read it often then, rarely otherwise.
  const linking = channel?.status === "starting";
  useEffect(() => {
    void loadChannels();
    const timer = setInterval(() => void loadChannels(), linking ? 1500 : 5000);
    return () => clearInterval(timer);
  }, [linking]);

  const base = channel ? draftOf(channel) : undefined;
  const draft: ChannelDraft | undefined = base && { ...base, ...edits };
  const dirty = Object.entries(edits).some(
    ([k, v]) => JSON.stringify(v) !== JSON.stringify(base?.[k as keyof ChannelDraft]),
  );
  const set = (patch: Partial<ChannelDraft>) => setEdits((e) => ({ ...e, ...patch }));
  const save = async (secret?: string) => {
    if (!id || !draft) return false;
    const sent = edits;
    const label = draft.label?.trim();
    const { label: _typed, ...rest } = draft;
    const ok = await saveChannel(id, label ? { ...rest, label } : rest, secret);
    // Only what went out is saved: an edit made while the save was on its way stays unsaved.
    if (ok) setEdits((now) => keptAfter(now, sent));
    return ok;
  };
  const create: Create = async (b, secret) => {
    const sent = edits;
    const secretary = Object.values(agents).find((a) => a.kind === "secretary")?.id ?? SUPER_AGENT_ID;
    const label = edits.label?.trim() || b.label;
    const ok = await saveChannel(
      newId,
      { ...b, type: edit.kind, agent_id: b.agent_id || secretary, ...(label ? { label } : {}) },
      secret,
    );
    if (ok) {
      setMade(newId);
      setEdits((now) => keptAfter(now, sent));
    }
    return ok;
  };
  const close = () => go.closeChannelDialogs();
  // A new account half made (never connected) is not kept; a connected one is, as it is.
  const dropHalfMade = () => {
    if (isNew && made && !connected) void saveChannel(made, null);
  };
  const leave = (then: () => void) => {
    if (!isNew && dirty) {
      setLeaveTo(() => then);
      setAsking("leave");
      return;
    }
    dropHalfMade();
    then();
  };
  const finish = async () => {
    if (!made) return;
    if (dirty && !(await save())) return;
    close();
    go.channel(made);
  };
  const cancelNew = () => {
    if (made) void saveChannel(made, null);
    close();
  };
  // ⌘S saves, as in the editors.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty && !isNew) void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const kindName = t(CHANNEL_KINDS[edit.kind].name);
  const paneProps: PaneProps | undefined =
    channel && draft ? { channel, draft, set, saveNow: (secret) => save(secret) } : undefined;
  const open = !isNew || connected;
  const panes = GROUPS.map((g) => ({
    ...g,
    panes: g.panes.filter(
      (p) => (p.id !== "rooms" || isRoomsKind(edit.kind)) && (p.id !== "stickers" || hasStickersPane(edit.kind)),
    ),
  }));
  const trailing = (p: Pane): ReactNode => {
    if (!channel) return undefined;
    const c = counts.get(channel.id);
    if (p === "account") return t(`tg.status.${channel.enabled ? channel.status : "off"}`);
    if (p === "answer") return agents[draft?.agent_id ?? channel.agent_id]?.name;
    if (p === "rooms") return channel.rooms?.rooms.length || undefined;
    if (p === "approvals") return c?.waiting || undefined;
    return undefined;
  };
  const contactsCount = useChannels(
    (s) => s.persons.filter((p) => channel && p.addresses.some((a) => a.channel === channel.id)).length,
  );
  const shown: Pane = open ? pane : "account";

  return (
    <Dialog
      bare
      size="xl"
      title={channel?.label ?? t("acct.newTitle", { kind: kindName })}
      closeLabel={t("common.close")}
      open
      onOpenChange={(o) => !o && leave(close)}
      className="config acct"
      style={SIZE}
    >
      <div className="acct__side">
        <Head
          channel={channel}
          title={isNew && !connected ? t("acct.newTitle", { kind: kindName }) : (channel?.label ?? kindName)}
          sub={channel && (connected || !isNew) ? accountLine(channel, t) : t("acct.notConnected")}
          kind={edit.kind}
          switchable={!isNew}
          onSwitch={(c) => {
            const kind = c.type;
            if (isChannelKind(kind)) leave(() => go.channelSettings(kind, c.id, pane));
          }}
        />
        <nav className="config__nav" aria-label={t("ch.settings")}>
          {panes.map((g) => (
            <div key={g.label} className="config__group">
              <div className="config__grouplabel">{t(g.label)}</div>
              {g.panes.map((p) => (
                <NavItem
                  key={p.id}
                  className="config__navitem"
                  icon={p.icon}
                  label={t(`acct.pane.${p.id}`)}
                  disabled={!open && p.id !== "account"}
                  count={p.id === "contacts" ? contactsCount : undefined}
                  trailing={open ? <span className="acct__trail">{trailing(p.id)}</span> : undefined}
                  active={shown === p.id}
                  onClick={() => setPane(p.id)}
                />
              ))}
            </div>
          ))}
        </nav>
      </div>
      <div className="acct__main">
        <div className="config__content">
          <div className="config__inner">
            <SectionHead
              title={t(`acct.pane.${shown}`)}
              lead={t(isNew && !connected && shown === "account" ? "acct.lead.accountNew" : LEAD[shown])}
            />
            {!paneProps || (isNew && !made) ? (
              <NewAccountPane kind={edit.kind} id={newId} label={edits.label ?? ""} set={set} create={create} />
            ) : shown === "account" ? (
              <AccountPane kind={edit.kind} onRemove={() => setAsking("remove")} {...paneProps} />
            ) : shown === "answer" ? (
              <AnswerPane {...paneProps} />
            ) : shown === "behavior" ? (
              <BehaviorPane {...paneProps} />
            ) : shown === "stickers" ? (
              <StickersPane {...paneProps} />
            ) : shown === "rooms" && isRoomsKind(edit.kind) ? (
              <RoomsSection
                channel={{ ...paneProps.channel, ...(paneProps.draft.rooms ? { rooms: paneProps.draft.rooms } : {}) }}
                kind={edit.kind}
                save={async (rooms) => set({ rooms })}
              />
            ) : shown === "contacts" ? (
              <ContactsPane channel={paneProps.channel} />
            ) : shown === "approvals" ? (
              <ApprovalsPane {...paneProps} />
            ) : (
              <ActivityPane channel={paneProps.channel} />
            )}
          </div>
        </div>
        <footer className="acct__foot">
          <span className="acct__state">
            {isNew && !connected ? t("acct.connectFirst") : dirty ? t("acct.unsaved") : t("acct.saved")}
          </span>
          {isNew ? (
            <>
              <Button variant="ghost" onClick={cancelNew}>
                {t("common.cancel")}
              </Button>
              <Button disabled={!connected} onClick={() => void finish()}>
                {t("acct.create")}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" disabled={!dirty} onClick={() => setEdits({})}>
                {t("acct.discard")}
              </Button>
              <Button
                variant="secondary"
                disabled={!dirty}
                onClick={() => void save()}
                trailingIcon={<Kbd keys={[MOD, "S"]} />}
              >
                {t("common.save")}
              </Button>
              <Button onClick={() => void (dirty ? save().then((ok) => ok && close()) : close())}>
                {t("acct.saveClose")}
              </Button>
            </>
          )}
        </footer>
      </div>
      {asking === "leave" && (
        <Confirm
          title={t("acct.discardTitle")}
          body={t("acct.discardBody")}
          yes={t("acct.discard")}
          onYes={() => {
            setAsking(undefined);
            setEdits({});
            leaveTo?.();
          }}
          onClose={() => setAsking(undefined)}
        />
      )}
      {asking === "remove" && channel && (
        <Confirm
          danger
          title={t("acct.removeTitle", { name: channel.label })}
          body={t("acct.removeBody")}
          yes={t("acct.disconnect")}
          onYes={() => {
            setAsking(undefined);
            void saveChannel(channel.id, null).then((ok) => ok && close());
          }}
          onClose={() => setAsking(undefined)}
        />
      )}
    </Dialog>
  );
}

/** Which account the dialog shows: its app, name and line; the name opens the others to switch to. */
function Head({
  channel,
  title,
  sub,
  kind,
  switchable,
  onSwitch,
}: {
  channel: ChannelInfo | undefined;
  title: string;
  sub: string;
  kind: keyof typeof CHANNEL_KINDS;
  switchable: boolean;
  onSwitch(c: ChannelInfo): void;
}) {
  const t = useT();
  const channels = useChannels((s) => s.channels);
  const titles = (
    <span className="acct__titles">
      <span className="acct__title">{title}</span>
      <span className="acct__headsub">{sub}</span>
    </span>
  );
  return (
    <div className="acct__head">
      <span className="chs__tile">
        <KindTile kind={kind} size={22} />
      </span>
      {switchable && channels.length > 1 ? (
        <Menu
          align="start"
          trigger={
            // ui: the menu opens from the account's name and line, two lines no kit button holds.
            <button type="button" className="acct__switch" aria-label={t("chs.switch")}>
              {titles}
              <Icons.ChevronDown size={14} />
            </button>
          }
          items={[
            { type: "label" as const, label: t("chs.accounts") },
            ...channels.map((c) => ({
              label: c.label,
              icon: isChannelKind(c.type) ? <KindTile kind={c.type} size={14} /> : <Icons.Send />,
              checked: c.id === channel?.id,
              onSelect: () => onSwitch(c),
            })),
          ]}
        />
      ) : (
        titles
      )}
    </div>
  );
}
