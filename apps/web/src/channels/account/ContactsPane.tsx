import type { Person } from "@apx/protocol";
import {
  Button,
  Dialog,
  EmptyState,
  IconButton,
  Icons,
  Input,
  Menu,
  PickRow,
  SearchField,
  Select,
  SettingRow,
  Switch,
} from "@apx/ui";
import { useMemo, useState } from "react";
import { shortWhen } from "../../common/format.ts";
import { SubHead } from "../../config/SectionHead.tsx";
import {
  addContact,
  type ChannelDraft,
  claimAddress,
  removePerson,
  saveContact,
  setPersonRole,
  useChannels,
} from "../../data/channels.ts";
import { useData } from "../../data/state.ts";
import { type MessageKey, useT } from "../../i18n/index.ts";
import { go } from "../../shell/nav.ts";
import { PersonAvatar } from "../PersonAvatar.tsx";
import { phoneOf } from "../PhoneForm.tsx";
import { initials, RELATION_KEY, RELATIONS } from "../people.ts";
import { accountPeople, keepSeen, type Seen, unclaimAddress, useSeen } from "./seen.ts";
import type { PaneProps } from "./types.ts";

/** A saved contact picked before they have a chat: the channel list names them instead of a chat. */
const PERSON_PICK = "person:";

/** One line of the list: someone on file with an address here, or someone who only wrote (in a room, mostly). */
type Row = {
  key: string;
  name: string;
  address: string | undefined;
  person: Person | undefined;
  /** Where they last wrote, when only that is known. */
  seen: Seen | undefined;
  chat: { id: string; at: string } | undefined;
  /** Their last message here, in private or in a room. */
  at: string | undefined;
};

/** What the owner is asked before an address changes hands: becoming theirs, or no longer. */
type Asking = { kind: "mine" | "notMine"; row: Row };

/**
 * Everyone on the account: those who wrote (in private or in its rooms) and those added by hand, a search, Add contact,
 * each one's relation, and which addresses are the owner's.
 */
export function ContactsPane({ channel, draft, set }: PaneProps) {
  const t = useT();
  const persons = useChannels((s) => s.persons);
  const threads = useData((s) => s.threads);
  const seen = useSeen(channel.id);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [asking, setAsking] = useState<Asking | null>(null);
  const rows = useMemo(() => {
    const chats = new Map<string, { id: string; at: string }>();
    for (const th of Object.values(threads))
      if (th.channel?.id === channel.id && th.channel.person_id)
        chats.set(th.channel.person_id, { id: th.id, at: th.updated_at });
    const wrote = new Map(seen.map((s) => [s.address, s]));
    const latest = (...at: (string | undefined)[]) => at.filter(Boolean).sort().at(-1);
    const { onFile, wroteOnly } = accountPeople(persons, seen, channel.id);
    const out: Row[] = onFile.map((p) => {
      const address = p.addresses.find((a) => a.channel === channel.id)?.external_id;
      const chat = chats.get(p.id);
      const last = p.addresses.filter((a) => a.channel === channel.id).map((a) => wrote.get(a.external_id)?.last_at);
      return { key: p.id, name: p.name, address, person: p, seen: undefined, chat, at: latest(chat?.at, ...last) };
    });
    for (const s of wroteOnly)
      out.push({
        key: `seen:${s.address}`,
        name: s.name,
        address: s.address,
        person: undefined,
        seen: s,
        chat: undefined,
        at: s.last_at,
      });
    return out.sort(
      (a, b) =>
        Number(b.person?.role === "owner") - Number(a.person?.role === "owner") ||
        (b.at ?? "").localeCompare(a.at ?? "") ||
        a.name.localeCompare(b.name),
    );
  }, [persons, threads, seen, channel.id]);
  const q = query.trim().toLowerCase();
  const shown = rows.filter(
    (r) => !q || `${r.name} ${r.person?.nickname ?? ""} ${r.address ?? ""}`.toLowerCase().includes(q),
  );
  return (
    <>
      <ContactDefaults draft={draft} set={set} />
      <SubHead>{t("acct.pane.contacts")}</SubHead>
      <div className="acct__tools">
        <SearchField
          size="sm"
          aria-label={t("acct.searchContacts")}
          placeholder={t("acct.searchContacts")}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
        {!adding && (
          <Button size="sm" variant="secondary" leadingIcon={<Icons.Plus size={14} />} onClick={() => setAdding(true)}>
            {t("acct.addContact")}
          </Button>
        )}
      </div>
      {adding && <AddContact channelId={channel.id} label={channel.label} done={() => setAdding(false)} />}
      {rows.length ? (
        <div className="acct__table">
          <div className="acct__thead" aria-hidden="true">
            <span>{t("acct.col.person")}</span>
            <span>{t("acct.col.relation")}</span>
            <span>{t("acct.col.last")}</span>
            <span />
          </div>
          <ul className="acct__tbody" aria-label={t("acct.pane.contacts")}>
            {shown.map((row) => (
              <ContactLine key={row.key} row={row} channelId={channel.id} ask={(kind) => setAsking({ kind, row })} />
            ))}
          </ul>
          {!shown.length && <p className="acct__none">{t("res.noMatch")}</p>}
        </div>
      ) : (
        <EmptyState variant="dashed" size="sm" icon={<Icons.Users />}>
          {t("acct.noContacts")}
        </EmptyState>
      )}
      {asking && <AskMine asking={asking} channelId={channel.id} done={() => setAsking(null)} />}
    </>
  );
}

function ContactLine({ row, channelId, ask }: { row: Row; channelId: string; ask(kind: Asking["kind"]): void }) {
  const t = useT();
  const { person, seen, chat } = row;
  const owner = person?.role === "owner";
  const open = () => {
    go.closeChannelDialogs();
    go.channel(channelId, chat?.id ?? (person ? `${PERSON_PICK}${person.id}` : (seen?.thread_id ?? "")));
  };
  const handle = row.address ? phoneOf(row.address) : undefined;
  const items = owner
    ? [{ label: t("acct.notMine"), onSelect: () => ask("notMine") }]
    : person
      ? [
          { label: t("acct.openChat"), onSelect: open },
          { label: t("ch.claim"), onSelect: () => ask("mine") },
          person.role === "blocked"
            ? { label: t("tg.unblock"), onSelect: () => void setPersonRole(person, "contact") }
            : { label: t("tg.block"), onSelect: () => void setPersonRole(person, "blocked") },
          { type: "separator" as const },
          { label: t("tg.forget"), danger: true, onSelect: () => void removePerson(person.id) },
        ]
      : [
          { label: t("acct.openWhere"), onSelect: open },
          { label: t("ch.claim"), onSelect: () => ask("mine") },
        ];
  return (
    <li className={`acct__trow${person?.role === "blocked" ? " is-off" : ""}`}>
      <PickRow
        className="acct__person"
        leading={<PersonAvatar personId={person?.id} name={row.name} fallback={initials(row.name)} size={28} />}
        title={owner ? t("ch.youNamed", { name: row.name }) : row.name}
        description={owner && handle ? t("acct.youBy", { address: handle }) : handle}
        {...(owner ? {} : { onClick: open })}
      />
      {owner || person?.role === "blocked" ? (
        <span className="acct__muted">{t(owner ? "tg.role.owner" : "tg.role.blocked")}</span>
      ) : (
        <RelationPick row={row} channelId={channelId} />
      )}
      <span className="acct__muted">{row.at ? shortWhen(row.at) : t("acct.noMessages")}</span>
      <span>
        <Menu
          align="end"
          trigger={<IconButton size="sm" label={t("chat.more")} icon={<Icons.Ellipsis size={14} />} />}
          items={items}
        />
      </span>
    </li>
  );
}

/**
 * Their relation, set right from the list. Someone who only wrote is kept as a contact the owner has not reviewed:
 * a relation answers nobody who was not answered before.
 */
function RelationPick({ row, channelId }: { row: Row; channelId: string }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const pick = async (v: string) => {
    const relation = RELATIONS.find((r) => r === v);
    setBusy(true);
    if (row.person) await saveContact(row.person.id, { name: row.person.name, relation: relation ?? null });
    else if (row.address && relation) await keepSeen(channelId, row.address, "contact", relation);
    setBusy(false);
  };
  // One cell of the row, whatever the picker renders beside its button.
  return (
    <span className="acct__relation">
      <Select
        size="sm"
        label={t("acct.relationOf", { name: row.name })}
        placeholder={t("ch.relation.none")}
        value={row.person?.relation ?? ""}
        disabled={busy}
        onValueChange={(v) => void pick(v ?? "")}
        options={[
          { value: "", label: t("ch.relation.none") },
          ...RELATIONS.map((r) => ({ value: r, label: t(RELATION_KEY[r]) })),
        ]}
      />
    </span>
  );
}

/** Before an address becomes the owner's, or stops being theirs: what changes, said in the owner's words. */
function AskMine({ asking, channelId, done }: { asking: Asking; channelId: string; done(): void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const { row, kind } = asking;
  const shownAddress = row.address ? phoneOf(row.address) : row.name;
  const address = row.person?.addresses.find((a) => a.channel === channelId && a.external_id === row.address);
  const confirm = async () => {
    setBusy(true);
    const ok =
      kind === "notMine"
        ? Boolean(address) && (await unclaimAddress(address?.id ?? ""))
        : address
          ? await claimAddress(address.id)
          : Boolean(row.address) && (await keepSeen(channelId, row.address ?? "", "owner"));
    setBusy(false);
    if (ok) done();
  };
  const body =
    kind === "notMine"
      ? t("acct.notMine.body", { address: shownAddress })
      : row.person
        ? t("acct.mine.bodyContact", { address: shownAddress, name: row.name })
        : t("acct.mine.body", { address: shownAddress });
  return (
    <Dialog
      open
      size="sm"
      onOpenChange={(o) => !o && done()}
      title={t(kind === "notMine" ? "acct.notMine.title" : "acct.mine.title")}
      description={body}
      closeLabel={t("common.close")}
      footer={
        <>
          <Button variant="secondary" onClick={done}>
            {t("common.cancel")}
          </Button>
          <Button variant={kind === "notMine" ? "danger" : "primary"} loading={busy} onClick={() => void confirm()}>
            {t(kind === "notMine" ? "acct.notMine.do" : "ch.claim.do")}
          </Button>
        </>
      }
    />
  );
}

/** What every contact of the account gets unless the owner set it on their card. */
function ContactDefaults({ draft, set }: Pick<PaneProps, "draft" | "set">) {
  const t = useT();
  const on = draft.contacts ?? {};
  const row = (k: keyof NonNullable<ChannelDraft["contacts"]>, label: MessageKey) => (
    <SettingRow key={k} title={t(label)}>
      <Switch
        size="sm"
        aria-label={t(label)}
        checked={on[k] === true}
        onCheckedChange={(v) => set({ contacts: { ...on, [k]: v } })}
      />
    </SettingRow>
  );
  return (
    <>
      <SubHead>{t("acct.contactsDefault")}</SubHead>
      <p className="config__lead">{t("acct.contactsDefaultHint")}</p>
      {row("requests", "ch.perm.requests")}
      {row("appointments", "ch.perm.appointments")}
      {row("notes", "ch.perm.notes")}
      {row("any_hour", "ch.anyHour")}
    </>
  );
}

/** A contact typed by hand: their name and their address on this account. */
function AddContact({ channelId, label, done }: { channelId: string; label: string; done(): void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = name.trim().length > 0 && address.trim().length >= 3;
  const add = async () => {
    if (!ok) return;
    setBusy(true);
    const made = await addContact(channelId, name.trim(), address.trim());
    setBusy(false);
    if (made) done();
  };
  return (
    <div className="acct__add">
      <div className="pform__field">
        <span className="pform__label">{t("ch.name")}</span>
        <Input aria-label={t("ch.name")} autoFocus value={name} onChange={(e) => setName(e.currentTarget.value)} />
      </div>
      <div className="pform__field">
        <span className="pform__label">{t("acct.contactAddress", { channel: label })}</span>
        <Input
          aria-label={t("acct.contactAddress", { channel: label })}
          value={address}
          onChange={(e) => setAddress(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && void add()}
        />
        <span className="pform__hint">{t("acct.contactAddressHint", { channel: label })}</span>
      </div>
      <div className="acct__addactions">
        <Button size="sm" variant="ghost" onClick={done}>
          {t("common.cancel")}
        </Button>
        <Button size="sm" disabled={!ok} loading={busy} onClick={() => void add()}>
          {t("acct.addContact")}
        </Button>
      </div>
    </div>
  );
}
