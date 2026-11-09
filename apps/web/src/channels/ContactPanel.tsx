import type { Person } from "@apx/protocol";
import { PERSON_RELATIONS } from "@apx/protocol/client";
import { Button, Help, IconButton, Icons, Input, SegmentedControl, Select, Textarea, Tooltip } from "@apx/ui";
import { useState } from "react";
import { claimAddress, neverRead, saveContact, useChannels } from "../data/channels.ts";
import { notify } from "../data/notices.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { RELATION_KEY } from "./people.ts";
import { ownerOn } from "./StartRows.tsx";

/**
 * A contact's card beside their chat: name and nickname, how they relate to the owner, who they are and the rules for
 * answering them (in the owner's words), what their chat may do (all off by default), whether they are answered past
 * the channel's attention hours, and silencing.
 */
const NO_RELATION = "none";

/** The rights a contact's card sets, in the order it shows them. */
const RIGHTS = ["appointments", "requests", "notes", "any_hour"] as const;
type Right = (typeof RIGHTS)[number];
const RIGHT_LABEL: Record<Right, MessageKey> = {
  appointments: "ch.perm.appointments",
  requests: "ch.perm.requests",
  notes: "ch.perm.notes",
  any_hour: "ch.anyHour",
};

export function ContactPanel({
  person,
  account,
  onClose,
}: {
  person: Person;
  /** The account this card is opened on: what its rights follow when nothing is set for them. */
  account: string;
  onClose(): void;
}) {
  const t = useT();
  const defaults = useChannels((s) => s.channels.find((c) => c.id === account)?.contacts);
  const mailbox = useChannels((s) => s.channels.find((c) => c.id === account)?.type === "email");
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
    RIGHTS.some((k) => d.perms[k] !== person.perms[k]);
  const save = async () => {
    setBusy(true);
    // Only the rights changed go out; one set back to the account goes as null.
    const perms = Object.fromEntries(
      RIGHTS.filter((k) => d.perms[k] !== person.perms[k]).map((k) => [k, d.perms[k] ?? null]),
    );
    const ok = await saveContact(person.id, { ...d, relation: d.relation ?? null, perms });
    setBusy(false);
    if (ok) notify(t("ch.saved"), "info");
  };
  // Each right: as the account says (and what that is), or on or off for this person only.
  const right = (k: Right) => {
    const own = d.perms[k];
    const account = t(defaults?.[k] ? "ch.right.yes" : "ch.right.no");
    return (
      <li key={k} className="chan__right">
        <span className="chan__rightlabel">{t(RIGHT_LABEL[k])}</span>
        <SegmentedControl
          size="sm"
          label={t(RIGHT_LABEL[k])}
          value={own === undefined ? "account" : own ? "on" : "off"}
          onValueChange={(v) =>
            setD((x) => {
              const perms = { ...x.perms };
              if (v === "account") delete perms[k];
              else perms[k] = v === "on";
              return { ...x, perms };
            })
          }
          options={[
            { value: "account", label: t("ch.right.account", { value: account }) },
            { value: "on", label: t("ch.right.yes") },
            { value: "off", label: t("ch.right.no") },
          ]}
        />
      </li>
    );
  };

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
        {mailbox && <NeverRead person={person} account={account} />}
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
        <ul className="chan__perms">{RIGHTS.map(right)}</ul>
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
 * On an email account: stop reading this sender, or everyone at their domain (a service's notices). Once stopped, the
 * card says by which entry and reads them again.
 */
function NeverRead({ person, account }: { person: Person; account: string }) {
  const t = useT();
  const list = useChannels((s) => s.channels.find((c) => c.id === account)?.email?.blocked);
  const address = person.addresses.find((a) => a.channel === account)?.external_id ?? "";
  const domain = address.split("@")[1];
  if (!address || person.role === "owner") return null;
  const by = list?.includes(address) ? "address" : domain && list?.includes(`@${domain}`) ? "domain" : undefined;
  if (by)
    return (
      <div className="pform__field">
        <span className="pform__label">{t("ch.notRead")}</span>
        <div className="chan__neverread">
          <span className="chan__neverread-what">{by === "address" ? address : `@${domain}`}</span>
          <Button size="sm" variant="secondary" onClick={() => void neverRead(person.id, account, by, true)}>
            {t("ch.readAgain")}
          </Button>
        </div>
        <span className="pform__hint">{t("ch.notReadHint")}</span>
      </div>
    );
  return (
    <div className="pform__field">
      <span className="pform__label">{t("ch.neverRead")}</span>
      <div className="chan__neverread">
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<Icons.BellOff size={14} />}
          onClick={() => void neverRead(person.id, account, "address")}
        >
          {address}
        </Button>
        {domain && (
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={<Icons.BellOff size={14} />}
            onClick={() => void neverRead(person.id, account, "domain")}
          >
            {t("ch.neverReadDomain", { domain })}
          </Button>
        )}
      </div>
      <span className="pform__hint">{t("ch.neverReadHint")}</span>
    </div>
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
