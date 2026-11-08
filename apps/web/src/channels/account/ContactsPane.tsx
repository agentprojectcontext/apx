import type { Person } from "@apx/protocol";
import { Button, EmptyState, IconButton, Icons, Input, Menu, PickRow, SearchField } from "@apx/ui";
import { useMemo, useState } from "react";
import { shortWhen } from "../../common/format.ts";
import { addContact, removePerson, setPersonRole, unlinkAddress, useChannels } from "../../data/channels.ts";
import { useData } from "../../data/state.ts";
import { useT } from "../../i18n/index.ts";
import { go } from "../../shell/nav.ts";
import { PersonAvatar } from "../PersonAvatar.tsx";
import { phoneOf } from "../PhoneForm.tsx";
import { initials, RELATION_KEY } from "../people.ts";
import type { PaneProps } from "./types.ts";

/** A saved contact picked before they have a chat: the channel list names them instead of a chat. */
const PERSON_PICK = "person:";

/** Everyone on the account, those who wrote and those added by hand: a search, Add contact, and each one's chat. */
export function ContactsPane({ channel }: Pick<PaneProps, "channel">) {
  const t = useT();
  const persons = useChannels((s) => s.persons);
  const threads = useData((s) => s.threads);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const rows = useMemo(() => {
    const chats = new Map<string, { id: string; at: string }>();
    for (const th of Object.values(threads))
      if (th.channel?.id === channel.id && th.channel.person_id)
        chats.set(th.channel.person_id, { id: th.id, at: th.updated_at });
    return persons
      .filter((p) => p.addresses.some((a) => a.channel === channel.id))
      .map((p) => ({ person: p, chat: chats.get(p.id) }))
      .sort(
        (a, b) =>
          Number(b.person.role === "owner") - Number(a.person.role === "owner") ||
          (b.chat?.at ?? "").localeCompare(a.chat?.at ?? "") ||
          a.person.name.localeCompare(b.person.name),
      );
  }, [persons, threads, channel.id]);
  const q = query.trim().toLowerCase();
  const shown = rows.filter((r) => !q || `${r.person.name} ${r.person.nickname ?? ""}`.toLowerCase().includes(q));
  return (
    <>
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
            {shown.map(({ person, chat }) => (
              <ContactLine key={person.id} person={person} channelId={channel.id} chat={chat} />
            ))}
          </ul>
          {!shown.length && <p className="acct__none">{t("res.noMatch")}</p>}
        </div>
      ) : (
        <EmptyState variant="dashed" size="sm" icon={<Icons.Users />}>
          {t("acct.noContacts")}
        </EmptyState>
      )}
    </>
  );
}

function ContactLine({
  person,
  channelId,
  chat,
}: {
  person: Person;
  channelId: string;
  chat: { id: string; at: string } | undefined;
}) {
  const t = useT();
  const address = person.addresses.find((a) => a.channel === channelId);
  const owner = person.role === "owner";
  const open = () => {
    go.closeChannelDialogs();
    go.channel(channelId, chat?.id ?? `${PERSON_PICK}${person.id}`);
  };
  return (
    <li className={`acct__trow${person.role === "blocked" ? " is-off" : ""}`}>
      <PickRow
        className="acct__person"
        leading={<PersonAvatar personId={person.id} name={person.name} fallback={initials(person.name)} size={28} />}
        title={owner ? t("ch.youNamed", { name: person.name }) : person.name}
        description={address ? phoneOf(address.external_id) : undefined}
        {...(owner ? {} : { onClick: open })}
      />
      <span className="acct__muted">
        {person.role === "blocked"
          ? t("tg.role.blocked")
          : person.relation
            ? t(RELATION_KEY[person.relation])
            : owner
              ? t("tg.role.owner")
              : ""}
      </span>
      <span className="acct__muted">{chat ? shortWhen(chat.at) : t("acct.noMessages")}</span>
      <span>
        <Menu
          align="end"
          trigger={<IconButton size="sm" label={t("chat.more")} icon={<Icons.Ellipsis size={14} />} />}
          items={
            owner
              ? [{ label: t("tg.unlink"), danger: true, onSelect: () => address && void unlinkAddress(address.id) }]
              : [
                  { label: t("acct.openChat"), onSelect: open },
                  person.role === "blocked"
                    ? { label: t("tg.unblock"), onSelect: () => void setPersonRole(person, "contact") }
                    : { label: t("tg.block"), onSelect: () => void setPersonRole(person, "blocked") },
                  { type: "separator" as const },
                  { label: t("tg.forget"), danger: true, onSelect: () => void removePerson(person.id) },
                ]
          }
        />
      </span>
    </li>
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
