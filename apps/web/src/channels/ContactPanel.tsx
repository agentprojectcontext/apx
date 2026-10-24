import type { Person } from "@apx/protocol";
import { PERSON_RELATIONS } from "@apx/protocol/client";
import { Button, Help, IconButton, Icons, Input, Select, Switch, Textarea, Tooltip } from "@apx/ui";
import { useState } from "react";
import { claimAddress, saveContact, useChannels } from "../data/channels.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import { RELATION_KEY } from "./people.ts";
import { ownerOn } from "./StartRows.tsx";

/**
 * A contact's card beside their chat: name and nickname, how they relate to the owner, who they are and the rules for
 * answering them (in the owner's words), what their chat may do (all off by default), whether they are answered past
 * the channel's attention hours, and silencing.
 */
const NO_RELATION = "none";

export function ContactPanel({ person, onClose }: { person: Person; onClose(): void }) {
  const t = useT();
  const [d, setD] = useState({
    name: person.name,
    nickname: person.nickname ?? "",
    relation: person.relation,
    note: person.note ?? "",
    rules: person.rules ?? "",
    any_hour: person.any_hour,
    perms: person.perms,
  });
  const [busy, setBusy] = useState(false);
  const dirty =
    d.name !== person.name ||
    d.nickname !== (person.nickname ?? "") ||
    d.relation !== person.relation ||
    d.note !== (person.note ?? "") ||
    d.rules !== (person.rules ?? "") ||
    d.any_hour !== person.any_hour ||
    JSON.stringify(d.perms) !== JSON.stringify(person.perms);
  const save = async () => {
    setBusy(true);
    const ok = await saveContact(person.id, { ...d, relation: d.relation ?? null });
    setBusy(false);
    if (ok) notify(t("ch.saved"), "info");
  };
  const perm = (k: keyof Person["perms"], label: string) => (
    <li>
      <Switch
        size="sm"
        checked={d.perms[k]}
        label={label}
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
          <Select
            label={t("ch.relation")}
            value={d.relation ?? NO_RELATION}
            onValueChange={(v) => {
              const relation = PERSON_RELATIONS.find((r) => r === v);
              setD({ ...d, relation });
            }}
            options={[
              { value: NO_RELATION, label: t("ch.relation.none") },
              ...PERSON_RELATIONS.map((r) => ({ value: r, label: t(RELATION_KEY[r]) })),
            ]}
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
        <div className="pform__label">
          {t("ch.may")}
          <Help
            label={t("ch.may.help")}
            title={t("ch.may.helpTitle")}
            className="chan__help"
            width={340}
            items={[
              { term: t("ch.perm.appointments"), text: t("ch.perm.appointmentsHint") },
              { term: t("ch.perm.requests"), text: t("ch.perm.requestsHint") },
              { term: t("ch.perm.notes"), text: t("ch.perm.notesHint") },
              { term: t("ch.anyHour"), text: t("ch.anyHourHint") },
            ]}
          >
            {t("ch.may.close")}
          </Help>
        </div>
        <ul className="chan__perms">
          {perm("appointments", t("ch.perm.appointments"))}
          {perm("requests", t("ch.perm.requests"))}
          {perm("notes", t("ch.perm.notes"))}
          <li>
            <Switch
              size="sm"
              checked={d.any_hour}
              label={t("ch.anyHour")}
              onCheckedChange={(on) => setD((x) => ({ ...x, any_hour: on }))}
            />
          </li>
        </ul>
        <ItsMine person={person} onDone={onClose} />
      </div>
      <footer className="chan__cardfoot">
        <Tooltip content={person.muted ? t("ch.unmuteHint") : t("ch.muteHint")}>
          <Button
            size="sm"
            variant="ghost"
            leadingIcon={<Icons.BellOff size={14} />}
            onClick={() => void saveContact(person.id, { name: person.name, muted: !person.muted })}
          >
            <span className="chan__cardfoot-text">{person.muted ? t("ch.unmute") : t("ch.mute")}</span>
          </Button>
        </Tooltip>
        <Tooltip content={t("ch.superviseHint")}>
          <Button
            size="sm"
            variant="ghost"
            leadingIcon={<Icons.Eye size={14} />}
            onClick={() => void saveContact(person.id, { name: person.name, supervised: !person.supervised })}
          >
            <span className="chan__cardfoot-text">{person.supervised ? t("ch.unsupervise") : t("ch.supervise")}</span>
          </Button>
        </Tooltip>
        <span className="chan__spacer" />
        <Tooltip content={t("ch.saveHint")}>
          <Button size="sm" disabled={!dirty || !d.name.trim()} loading={busy} onClick={() => void save()}>
            {t("common.save")}
          </Button>
        </Tooltip>
      </footer>
    </aside>
  );
}

/**
 * An address approved as a contact by mistake that is really the owner's: "This account is mine" gives it (and its
 * chats on that channel) to the owner, after saying what will happen. Once the owner has an account on that channel
 * the question is settled, so it is not offered.
 */
function ItsMine({ person, onDone }: { person: Person; onDone(): void }) {
  const t = useT();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const address = person.addresses[0];
  const settled = useChannels((s) => ownerOn(s.persons, address?.channel ?? ""));
  if (!address || settled) return null;
  const claim = async () => {
    setBusy(true);
    const ok = await claimAddress(address.id);
    setBusy(false);
    if (ok) onDone();
  };
  return (
    <div className="chan__mine">
      <div className="chan__minehead">
        <Icons.TriangleAlert size={14} />
        <span>{t("ch.claim.title")}</span>
      </div>
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
        <>
          <p className="chan__minehint">{t("ch.claim.hint")}</p>
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={<Icons.UserRound size={14} />}
            onClick={() => setAsking(true)}
          >
            {t("ch.claim")}
          </Button>
        </>
      )}
    </div>
  );
}
