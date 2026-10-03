import type { Person } from "@apx/protocol";
import { PERSON_RELATIONS } from "@apx/protocol/client";
import { Button, IconButton, Icons, Input, Menu, Switch, Textarea } from "@apx/ui";
import { useState } from "react";
import { claimAddress, saveContact } from "../data/channels.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import { RELATION_KEY } from "./ChannelScreen.tsx";

/**
 * A contact's card beside their chat: name and nickname, how they relate to the owner, who they are and the rules for
 * answering them (in the owner's words), what their chat may do (all off by default), and silencing.
 */
export function ContactPanel({ person, onClose }: { person: Person; onClose(): void }) {
  const t = useT();
  const [d, setD] = useState({
    name: person.name,
    nickname: person.nickname ?? "",
    relation: person.relation,
    note: person.note ?? "",
    rules: person.rules ?? "",
    perms: person.perms,
  });
  const [busy, setBusy] = useState(false);
  const dirty =
    d.name !== person.name ||
    d.nickname !== (person.nickname ?? "") ||
    d.relation !== person.relation ||
    d.note !== (person.note ?? "") ||
    d.rules !== (person.rules ?? "") ||
    JSON.stringify(d.perms) !== JSON.stringify(person.perms);
  const save = async () => {
    setBusy(true);
    const ok = await saveContact(person.id, { ...d, relation: d.relation ?? null });
    setBusy(false);
    if (ok) notify(t("ch.saved"), "info");
  };
  const perm = (k: keyof Person["perms"], label: string, hint: string) => (
    <li>
      <Switch
        size="sm"
        checked={d.perms[k]}
        label={label}
        description={hint}
        onCheckedChange={(on) => setD((x) => ({ ...x, perms: { ...x.perms, [k]: on } }))}
      />
    </li>
  );

  return (
    <aside className="chan__card" aria-label={t("ch.contact")}>
      <header className="chan__cardhead">
        <span>{t("ch.contact")}</span>
        <IconButton size="sm" label={t("common.close")} icon={<Icons.X size={14} />} onClick={onClose} />
      </header>
      <div className="chan__cardbody">
        <ItsMine person={person} onDone={onClose} />
        <div className="chan__pair">
          <div className="pform__field">
            <span className="pform__label">{t("ch.name")}</span>
            <Input
              aria-label={t("ch.name")}
              value={d.name}
              onChange={(e) => setD({ ...d, name: e.currentTarget.value })}
            />
          </div>
          <div className="pform__field">
            <span className="pform__label">{t("ch.nickname")}</span>
            <Input
              aria-label={t("ch.nickname")}
              value={d.nickname}
              onChange={(e) => setD({ ...d, nickname: e.currentTarget.value })}
            />
          </div>
        </div>
        <div className="pform__field">
          <span className="pform__label">{t("ch.relation")}</span>
          <Menu
            align="start"
            items={PERSON_RELATIONS.map((r) => ({
              label: t(RELATION_KEY[r]),
              icon: r === d.relation ? <Icons.Check /> : <span />,
              onSelect: () => setD({ ...d, relation: r }),
            }))}
            trigger={
              <button type="button" className="selectbtn chan__select" aria-label={t("ch.relation")}>
                <span className="selectbtn__text">
                  {d.relation ? t(RELATION_KEY[d.relation]) : t("ch.relation.none")}
                </span>
                <Icons.ChevronDown size={12} />
              </button>
            }
          />
        </div>
        <div className="pform__field">
          <span className="pform__label">{t("ch.who.is")}</span>
          <Textarea
            aria-label={t("ch.who.is")}
            rows={3}
            value={d.note}
            onChange={(e) => setD({ ...d, note: e.currentTarget.value })}
          />
          <span className="pform__hint">{t("ch.who.isHint")}</span>
        </div>
        <div className="pform__field">
          <span className="pform__label">{t("ch.rules")}</span>
          <Textarea
            aria-label={t("ch.rules")}
            rows={3}
            value={d.rules}
            onChange={(e) => setD({ ...d, rules: e.currentTarget.value })}
          />
          <span className="pform__hint">{t("ch.rulesHint")}</span>
        </div>
        <div className="pform__label">{t("ch.may")}</div>
        <ul className="chan__perms">
          {perm("appointments", t("ch.perm.appointments"), t("ch.perm.appointmentsHint"))}
          {perm("requests", t("ch.perm.requests"), t("ch.perm.requestsHint"))}
          {perm("notes", t("ch.perm.notes"), t("ch.perm.notesHint"))}
        </ul>
      </div>
      <footer className="chan__cardfoot">
        <Button
          size="sm"
          variant="ghost"
          leadingIcon={<Icons.BellOff size={14} />}
          onClick={() => void saveContact(person.id, { name: person.name, muted: !person.muted })}
        >
          {person.muted ? t("ch.unmute") : t("ch.mute")}
        </Button>
        <span className="chan__spacer" />
        <Button size="sm" disabled={!dirty || !d.name.trim()} loading={busy} onClick={() => void save()}>
          {t("common.save")}
        </Button>
      </footer>
    </aside>
  );
}

/**
 * An address approved as a contact by mistake that is really the owner's: "This account is mine" gives it (and its
 * chats on that channel) to the owner, after saying what will happen.
 */
function ItsMine({ person, onDone }: { person: Person; onDone(): void }) {
  const t = useT();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const address = person.addresses[0];
  if (!address) return null;
  const claim = async () => {
    setBusy(true);
    const ok = await claimAddress(address.id);
    setBusy(false);
    if (ok) onDone();
  };
  return (
    <div className="chan__mine">
      {asking ? (
        <>
          <p>{t("ch.claim.confirm", { name: person.name })}</p>
          <div className="chan__mineact">
            <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" loading={busy} onClick={() => void claim()}>
              {t("ch.claim.do")}
            </Button>
          </div>
        </>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<Icons.UserRound size={14} />}
          onClick={() => setAsking(true)}
        >
          {t("ch.claim")}
        </Button>
      )}
    </div>
  );
}
