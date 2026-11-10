import type { ChannelInfo, Person } from "@apx/protocol";
import { Button, Icons, Input, SegmentedControl, Select, Switch, Textarea, Tooltip } from "@apx/ui";
import { useState } from "react";
import { AgentSelect } from "../common/pickers/AgentSelect.tsx";
import { claimAddress, neverRead, saveContact, useChannels } from "../data/channels.ts";
import { notify } from "../data/notices.ts";
import { useData } from "../data/state.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { CardField, ChatCard } from "./ChatCard.tsx";
import { PersonAvatar } from "./PersonAvatar.tsx";
import { initials, RELATION_KEY } from "./people.ts";
import { ownerOn } from "./StartRows.tsx";

/** The relations, the ones most chats need first. */
const RELATIONS: NonNullable<Person["relation"]>[] = [
  "client",
  "lead",
  "associate",
  "provider",
  "family",
  "friend",
  "partner",
  "coworker",
  "other",
];

/** The rights a contact's card sets, in the order it shows them. */
const RIGHTS = ["appointments", "requests", "notes", "any_hour"] as const;
type Right = (typeof RIGHTS)[number];
const RIGHT_LABEL: Record<Right, MessageKey> = {
  appointments: "ch.perm.appointments",
  requests: "ch.perm.requests",
  notes: "ch.perm.notes",
  any_hour: "ch.anyHour",
};
const RIGHT_HINT: Record<Right, MessageKey> = {
  appointments: "ch.perm.appointmentsHint",
  requests: "ch.perm.requestsHint",
  notes: "ch.perm.notesHint",
  any_hour: "ch.anyHourHint",
};

/**
 * A contact's card beside their chat: who they are on top, then name and nickname, how they relate to the owner, who
 * answers them (the account's contacts agent or one of their own), who they are and the rules for answering them (in
 * the owner's words), what their chat may do and whether they are answered past the account's
 * attention hours, and silencing.
 */
export function ContactPanel({
  person,
  channel,
  onClose,
}: {
  person: Person;
  /** The account this card is opened on: who answers them and what their rights follow when nothing is set. */
  channel: ChannelInfo;
  onClose(): void;
}) {
  const t = useT();
  const defaults = channel.contacts;
  const mailbox = channel.type === "email";
  const [d, setD] = useState({
    name: person.name,
    nickname: person.nickname ?? "",
    relation: person.relation,
    note: person.note ?? "",
    rules: person.rules ?? "",
    perms: person.perms,
    agent_id: person.agent_id,
  });
  const [other, setOther] = useState(Boolean(person.agent_id));
  const accountAgent = useData((s) => s.agents[channel.contacts_agent_id ?? channel.agent_id]);
  const [busy, setBusy] = useState(false);
  const dirty =
    d.name !== person.name ||
    d.nickname !== (person.nickname ?? "") ||
    d.relation !== person.relation ||
    d.note !== (person.note ?? "") ||
    d.rules !== (person.rules ?? "") ||
    d.agent_id !== person.agent_id ||
    RIGHTS.some((k) => d.perms[k] !== person.perms[k]);
  const save = async () => {
    setBusy(true);
    // Only the rights changed go out; one set back to the account goes as null.
    const perms = Object.fromEntries(
      RIGHTS.filter((k) => d.perms[k] !== person.perms[k]).map((k) => [k, d.perms[k] ?? null]),
    );
    const ok = await saveContact(person.id, {
      ...d,
      relation: d.relation ?? null,
      perms,
      agent_id: d.agent_id ?? null,
    });
    setBusy(false);
    if (ok) notify(t("ch.saved"), "info");
  };
  // Each right: as the account says (and what that is), or on or off for this person only.
  const right = (k: Right) => {
    const own = d.perms[k];
    const account = t(defaults?.[k] ? "ch.right.yes" : "ch.right.no");
    return (
      <li key={k} className="chan__right">
        <span className="chan__rightlabel">
          {t(RIGHT_LABEL[k])}
          <span className="chan__righthint">{t(RIGHT_HINT[k])}</span>
        </span>
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
    <ChatCard
      title={t("ch.contact")}
      channel={channel}
      name={person.name}
      avatar={
        <PersonAvatar
          personId={person.id}
          name={person.name}
          className="chan__cardavatar"
          size={44}
          fallback={initials(person.name)}
        />
      }
      onClose={onClose}
      footer={
        <>
          <span className="chan__spacer" />
          <Tooltip content={t("ch.saveHint")}>
            <Button size="sm" disabled={!dirty || !d.name.trim()} loading={busy} onClick={() => void save()}>
              {t("common.save")}
            </Button>
          </Tooltip>
        </>
      }
    >
      <div className="chan__pair">
        <CardField label={t("ch.name")}>
          <Input
            aria-label={t("ch.name")}
            value={d.name}
            onChange={(e) => setD({ ...d, name: e.currentTarget.value })}
          />
        </CardField>
        <CardField label={t("ch.nickname")}>
          <Input
            aria-label={t("ch.nickname")}
            value={d.nickname}
            onChange={(e) => setD({ ...d, nickname: e.currentTarget.value })}
          />
        </CardField>
      </div>
      <CardField label={t("ch.relation")} hint={t("ch.relation.hint")}>
        <Select
          size="sm"
          label={t("ch.relation")}
          placeholder={t("ch.relation.none")}
          value={d.relation ?? ""}
          onValueChange={(v) => setD({ ...d, relation: RELATIONS.find((r) => r === v) })}
          options={[
            { value: "", label: t("ch.relation.none") },
            ...RELATIONS.map((r) => ({ value: r, label: t(RELATION_KEY[r]) })),
          ]}
        />
      </CardField>
      <ContactSwitches person={person} />
      {mailbox && <NeverRead person={person} account={channel.id} />}
      <CardField label={t("ch.answers")} hint={other ? t("ch.answers.otherHint", { name: person.name }) : undefined}>
        <SegmentedControl
          size="sm"
          className="chan__answers"
          label={t("ch.answers")}
          value={other ? "other" : "account"}
          onValueChange={(v) => {
            setOther(v === "other");
            if (v === "account") setD((x) => ({ ...x, agent_id: undefined }));
          }}
          options={[
            { value: "account", label: t("ch.answers.account", { agent: accountAgent?.name ?? "" }) },
            { value: "other", label: t("ch.answers.other") },
          ]}
        />
        {other && (
          <AgentSelect
            size="sm"
            channel
            label={t("ch.answers.pick", { name: person.name })}
            value={d.agent_id}
            onChange={(id) => id && setD((x) => ({ ...x, agent_id: id }))}
          />
        )}
      </CardField>
      <CardField label={t("ch.who.is")} hint={t("ch.who.isHint")}>
        <Textarea
          aria-label={t("ch.who.is")}
          rows={3}
          placeholder={t("ch.who.placeholder")}
          value={d.note}
          onChange={(e) => setD({ ...d, note: e.currentTarget.value })}
        />
      </CardField>
      <CardField label={t("ch.rules")} hint={t("ch.rulesHint")}>
        <Textarea
          aria-label={t("ch.rules")}
          rows={2}
          placeholder={t("ch.rules.placeholder")}
          value={d.rules}
          onChange={(e) => setD({ ...d, rules: e.currentTarget.value })}
        />
      </CardField>
      <CardField label={t("ch.may")} hint={t("ch.may.close")}>
        <ul className="chan__perms">{RIGHTS.map(right)}</ul>
      </CardField>
      <ItsMine person={person} onDone={onClose} />
    </ChatCard>
  );
}

/** Silenced and supervised apply at once, each a switch that shows where it stands. */
function ContactSwitches({ person }: { person: Person }) {
  const t = useT();
  // What was just switched shows right away; the saved contact catches up.
  const [mine, setMine] = useState<{ muted?: boolean; supervised?: boolean }>({});
  const muted = mine.muted ?? person.muted;
  const supervised = mine.supervised ?? person.supervised;
  const flip = async (key: "muted" | "supervised", on: boolean) => {
    setMine((m) => ({ ...m, [key]: on }));
    await saveContact(person.id, { name: person.name, [key]: on });
    setMine((m) => ({ ...m, [key]: undefined }));
  };
  return (
    <div className="chan__switches">
      <Switch
        size="sm"
        label={t("ch.muted")}
        description={t("ch.muteHint")}
        checked={muted}
        onCheckedChange={(on) => void flip("muted", on)}
      />
      <Switch
        size="sm"
        label={t("ch.supervise")}
        description={t("ch.superviseHint")}
        checked={Boolean(supervised)}
        onCheckedChange={(on) => void flip("supervised", on)}
      />
    </div>
  );
}

/**
 * On an email account: stop reading this sender, or everyone at their domain (a service's notices), each a switch.
 * Turning one off reads them again.
 */
function NeverRead({ person, account }: { person: Person; account: string }) {
  const t = useT();
  const list = useChannels((s) => s.channels.find((c) => c.id === account)?.email?.blocked);
  const [mine, setMine] = useState<{ address?: boolean; domain?: boolean }>({});
  const address = person.addresses.find((a) => a.channel === account)?.external_id ?? "";
  const domain = address.split("@")[1];
  if (!address || person.role === "owner") return null;
  const on = {
    address: mine.address ?? Boolean(list?.includes(address)),
    domain: mine.domain ?? Boolean(domain && list?.includes(`@${domain}`)),
  };
  const flip = async (scope: "address" | "domain", value: boolean) => {
    setMine((m) => ({ ...m, [scope]: value }));
    await neverRead(person.id, account, scope, !value);
    setMine((m) => ({ ...m, [scope]: undefined }));
  };
  return (
    <CardField label={t("ch.neverRead")} hint={t("ch.neverReadHint")}>
      <div className="chan__switches">
        {domain && (
          <Switch
            size="sm"
            label={t("ch.neverReadDomain", { domain })}
            checked={on.domain}
            onCheckedChange={(v) => void flip("domain", v)}
          />
        )}
        {/* The whole domain already covers this address: it reads as skipped and is settled up there. */}
        <Switch
          size="sm"
          label={address}
          checked={on.domain || on.address}
          disabled={on.domain}
          onCheckedChange={(v) => void flip("address", v)}
        />
      </div>
    </CardField>
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
