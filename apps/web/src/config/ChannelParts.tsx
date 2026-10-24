// What every channel's settings share: who answers and how, who waits to be let in, the people on it, what was sent,
// and how notices reach the owner.
import type { ChannelClosers, ChannelHours, ChannelInfo, ChannelResearch, OutboxItem, Person } from "@apx/protocol";
import { Badge, Button, IconButton, Icons, Input, Menu, SegmentedControl, SettingRow, Switch } from "@apx/ui";
import { useMemo, useState } from "react";
import { ownerOn, PairingRow } from "../channels/StartRows.tsx";
import { AgentSelect } from "../common/pickers/AgentSelect.tsx";
import { WeekDays } from "../common/pickers/WeekDays.tsx";
import {
  type ChannelDraft,
  removePerson,
  respondPairing,
  saveNotices,
  setPersonRole,
  unlinkAddress,
  useChannels,
} from "../data/channels.ts";
import { useOwnerTimeZone } from "../data/owner.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { SubHead } from "./SectionHead.tsx";

export const STATUS: Record<ChannelInfo["status"], "brand" | "neutral" | "warning" | "danger"> = {
  running: "brand",
  starting: "neutral",
  off: "neutral",
  error: "danger",
};

/** Channels whose adapter puts emoji on messages (a new one with reactions joins here). */
const REACTS = new Set<ChannelInfo["type"]>(["telegram", "whatsapp"]);

/** On the owner's own WhatsApp number a stranger never gets a code from it: "pair" only lists them. */
const listsOnly = (c: ChannelInfo) => c.type === "whatsapp" && c.self_owner === true;
const strangerMode = (c: ChannelInfo) => (c.strangers === "pair" && listsOnly(c) ? "list" : c.strangers);
const STRANGER_HINT: Record<ReturnType<typeof strangerMode>, MessageKey> = {
  pair: "ch.strangersHint.pair",
  list: "ch.strangersHint.list",
  ask: "ch.strangersHint.ask",
  answer: "ch.strangersHint.answer",
  ignore: "ch.strangersHint.ignore",
};

/** Who answers on the channel and how: the agent, where the owner's words go, overlapping messages, strangers. */
export function Behavior({
  channel,
  save,
}: {
  channel: ChannelInfo;
  save(patch: Partial<ChannelDraft>): Promise<unknown>;
}) {
  const t = useT();
  return (
    <>
      <SubHead>{t("tg.behavior")}</SubHead>
      <SettingRow title={t("tg.agent")} description={t("tg.agentHint", { channel: channel.label })}>
        <AgentSelect
          size="sm"
          className="tgagent"
          value={channel.agent_id}
          onChange={(id) => id && id !== channel.agent_id && void save({ agent_id: id })}
        />
      </SettingRow>
      <SettingRow title={t("tg.ownerThread")} description={t("tg.ownerThreadHint", { channel: channel.label })}>
        <SegmentedControl
          size="sm"
          label={t("tg.ownerThread")}
          value={channel.owner_thread}
          onValueChange={(v) => void save({ owner_thread: v as ChannelDraft["owner_thread"] })}
          options={[
            { value: "home", label: t("tg.ownerThread.home") },
            { value: "own", label: t("tg.ownerThread.own") },
          ]}
        />
      </SettingRow>
      <SettingRow title={t("tg.concurrency")} description={t(`ch.concurrencyHint.${channel.concurrency}`)}>
        <SegmentedControl
          size="sm"
          label={t("tg.concurrency")}
          value={channel.concurrency}
          onValueChange={(v) => void save({ concurrency: v as ChannelDraft["concurrency"] })}
          options={[
            { value: "queue", label: t("tg.concurrency.queue") },
            { value: "interrupt", label: t("tg.concurrency.interrupt") },
            { value: "steer", label: t("tg.concurrency.steer") },
          ]}
        />
      </SettingRow>
      {REACTS.has(channel.type) && (
        <SettingRow title={t("ch.closers")} description={t(`ch.closersHint.${channel.closers ?? "silent"}`)}>
          <SegmentedControl
            size="sm"
            label={t("ch.closers")}
            value={channel.closers ?? "silent"}
            onValueChange={(v) => void save({ closers: v as ChannelClosers })}
            options={[
              { value: "silent", label: t("ch.closers.silent") },
              { value: "react", label: t("ch.closers.react") },
            ]}
          />
        </SettingRow>
      )}
      <SettingRow title={t("ch.research")} description={t(`ch.researchHint.${channel.research ?? "owner"}`)}>
        <SegmentedControl
          size="sm"
          label={t("ch.research")}
          value={channel.research ?? "owner"}
          onValueChange={(v) => void save({ research: v as ChannelResearch })}
          options={[
            { value: "off", label: t("ch.research.off") },
            { value: "owner", label: t("ch.research.owner") },
            { value: "everyone", label: t("ch.research.everyone") },
          ]}
        />
      </SettingRow>
      <Hours channel={channel} save={save} />
      <SettingRow title={t("tg.strangers")} description={t(STRANGER_HINT[strangerMode(channel)])}>
        <SegmentedControl
          size="sm"
          label={t("tg.strangers")}
          value={channel.strangers}
          onValueChange={(v) => void save({ strangers: v as ChannelDraft["strangers"] })}
          options={[
            { value: "pair", label: t(listsOnly(channel) ? "ch.strangers.list" : "tg.strangers.pair") },
            { value: "ask", label: t("ch.strangers.ask") },
            { value: "answer", label: t("ch.strangers.answer") },
            { value: "ignore", label: t("tg.strangers.ignore") },
          ]}
        />
      </SettingRow>
    </>
  );
}

/** Hours a channel starts with when the owner turns them on: every day, a working day's span. */
const FIRST_HOURS: ChannelHours = { days: [1, 2, 3, 4, 5, 6, 0], from: "08:00", to: "22:00" };

/** When it answers contacts, in the owner's time zone: at any hour, or on some days between two times. */
function Hours({ channel, save }: { channel: ChannelInfo; save(patch: Partial<ChannelDraft>): Promise<unknown> }) {
  const t = useT();
  const zone = useOwnerTimeZone();
  const hours = channel.hours;
  const set = (patch: Partial<ChannelHours>) => hours && void save({ hours: { ...hours, ...patch } });
  const time = (key: "from" | "to", label: string) => (
    <Input
      className="chhours__time"
      aria-label={label}
      type="time"
      value={hours?.[key] ?? ""}
      onChange={(e) => e.currentTarget.value && set({ [key]: e.currentTarget.value })}
    />
  );
  return (
    <>
      <SettingRow title={t("ch.hours")} description={t(hours ? "ch.hoursHint.on" : "ch.hoursHint.off")}>
        <Switch
          size="sm"
          checked={Boolean(hours)}
          onCheckedChange={(on) => void save({ hours: on ? FIRST_HOURS : undefined })}
          aria-label={t("ch.hours")}
        />
      </SettingRow>
      {hours && (
        <SettingRow
          stacked
          title={t("ch.hoursWhen")}
          description={zone ? t("ch.hoursZone", { zone }) : t("ch.hoursZoneLocal")}
        >
          <div className="chhours">
            <WeekDays days={hours.days} label={t("ch.hoursDays")} onChange={(days) => set({ days })} />
            <span className="chhours__span">
              <span className="tgquiet__word">{t("tg.quietFrom")}</span>
              {time("from", t("tg.quietFrom"))}
              <span className="tgquiet__word">{t("tg.quietTo")}</span>
              {time("to", t("tg.quietTo"))}
            </span>
          </div>
        </SettingRow>
      )}
    </>
  );
}

/**
 * Who wrote and waits to be let in, shown only while someone does. On a bot channel whose owner is not linked yet,
 * the owner links their own chat with the code the bot sent; once linked they show under People as themselves.
 */
export function Pairing({
  channelId,
  itsMe,
}: {
  channelId: string;
  /** A bot channel: the owner links their own account with the code the bot sent them. */
  itsMe?: { title: string; hint: string } | undefined;
}) {
  const t = useT();
  const all = useChannels((s) => s.pairing);
  const linked = useChannels((s) => ownerOn(s.persons, channelId));
  const requests = useMemo(() => all.filter((r) => r.channel === channelId), [all, channelId]);
  const [code, setCode] = useState("");
  return (
    <>
      {itsMe && !linked && (
        <>
          <SubHead>{t("tg.yourAccount")}</SubHead>
          <SettingRow title={itsMe.title} description={itsMe.hint}>
            <div className="tgtoken">
              <Input
                aria-label={t("tg.code")}
                inputMode="numeric"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.currentTarget.value.replace(/\D/g, "").slice(0, 6))}
              />
              <Button
                size="sm"
                disabled={code.length !== 6}
                onClick={() => void respondPairing(code, "owner").then(() => setCode(""))}
              >
                {t("tg.link")}
              </Button>
            </div>
          </SettingRow>
        </>
      )}
      {requests.length > 0 && (
        <>
          <SubHead>{t("tg.pairing")}</SubHead>
          <ul className="chan__rows">
            {requests.map((r) => (
              <PairingRow key={r.code} request={r} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}

export function People({ channelId }: { channelId: string }) {
  const t = useT();
  const all = useChannels((s) => s.persons);
  const label = useChannels((s) => s.channels.find((c) => c.id === channelId)?.label ?? channelId);
  const persons = all.filter((p) => p.addresses.some((a) => a.channel === channelId));
  if (!persons.length) return null;
  return (
    <>
      <SubHead>{t("tg.people", { channel: label })}</SubHead>
      <ul className="res__list">
        {persons.map((p) => (
          <PersonRow key={p.id} person={p} channelId={channelId} />
        ))}
      </ul>
    </>
  );
}

function PersonRow({ person, channelId }: { person: Person; channelId: string }) {
  const t = useT();
  const address = person.addresses.find((a) => a.channel === channelId);
  return (
    <li className="res__row">
      <Icons.User size={14} className="res__icon" />
      <div className="res__main">
        <div className="res__name">{person.name}</div>
        <div className="res__desc">{address?.label ?? address?.external_id}</div>
      </div>
      <Badge tone={person.role === "owner" ? "brand" : person.role === "blocked" ? "danger" : "neutral"}>
        {t(`tg.role.${person.role}`)}
      </Badge>
      <Menu
        align="end"
        trigger={<IconButton size="sm" label={t("chat.more")} icon={<Icons.Ellipsis size={14} />} />}
        items={
          person.role === "owner"
            ? [{ label: t("tg.unlink"), danger: true, onSelect: () => address && void unlinkAddress(address.id) }]
            : [
                person.role === "blocked"
                  ? { label: t("tg.unblock"), onSelect: () => void setPersonRole(person, "contact") }
                  : { label: t("tg.block"), onSelect: () => void setPersonRole(person, "blocked") },
                { type: "separator" as const },
                { label: t("tg.forget"), danger: true, onSelect: () => void removePerson(person.id) },
              ]
        }
      />
    </li>
  );
}

/** What went out without words: a sticker (with what it shows) or an emoji put on a message. */
function sentLabel(o: OutboxItem, t: ReturnType<typeof useT>): string {
  if (o.sticker !== undefined) return o.sticker ? t("tg.out.stickerAbout", { about: o.sticker }) : t("tg.out.sticker");
  return o.reaction ? t("tg.out.reaction", { emoji: o.reaction }) : "";
}

export function Deliveries({ channelId }: { channelId: string }) {
  const t = useT();
  const outbox = useChannels((s) => s.outbox);
  const items = outbox.filter((o) => o.channel === channelId).slice(0, 8);
  if (!items.length) return null;
  return (
    <>
      <SubHead>{t("tg.sent")}</SubHead>
      <ul className="res__list">
        {items.map((o) => (
          <li key={o.id} className="res__row">
            <Badge
              tone={
                o.state === "sent"
                  ? "neutral"
                  : o.state === "failed"
                    ? "danger"
                    : o.state === "uncertain"
                      ? "warning"
                      : "neutral"
              }
              dot
            >
              {t(`tg.out.${o.state}`)}
            </Badge>
            <div className="res__main">
              <div className="res__desc">{o.text || sentLabel(o, t)}</div>
              {o.error && o.state !== "sent" && <div className="res__desc tgcard__error">{o.error}</div>}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

const FOLLOW_UP = ["0", "60", "120", "600"] as const;

/** How notices reach the owner: when a pending confirmation follows them here, and quiet hours. */
export function Notices() {
  const t = useT();
  const prefs = useChannels((s) => s.notices);
  if (!prefs) return null;
  return (
    <>
      <SubHead>{t("tg.notices")}</SubHead>
      <SettingRow title={t("tg.followUp")} description={t("tg.followUpHint")}>
        <SegmentedControl
          size="sm"
          label={t("tg.followUp")}
          value={String(prefs.inputs_after_s)}
          onValueChange={(v) => void saveNotices({ ...prefs, inputs_after_s: Number(v) })}
          options={FOLLOW_UP.map((v) => ({ value: v, label: t(`tg.followUp.${v}`) }))}
        />
      </SettingRow>
      <SettingRow title={t("tg.quiet")} description={t("nudge.linkHint")}>
        <Button size="sm" variant="secondary" onClick={() => go.config("interruptions")}>
          {t("nudge.open")}
        </Button>
      </SettingRow>
    </>
  );
}
