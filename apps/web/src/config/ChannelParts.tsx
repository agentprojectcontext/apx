// What every channel's settings share: who answers and how, who waits to be let in, the people on it, what was sent,
// and how notices reach the owner.
import type { ChannelInfo, Person } from "@apx/protocol";
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  Icons,
  Input,
  Menu,
  SegmentedControl,
  SettingRow,
  Switch,
} from "@apx/ui";
import { useMemo, useState } from "react";
import { PairingRow } from "../channels/StartRows.tsx";
import { AgentSelect } from "../common/pickers/AgentSelect.tsx";
import {
  type ChannelDraft,
  removePerson,
  respondPairing,
  saveNotices,
  setPersonRole,
  unlinkAddress,
  useChannels,
} from "../data/channels.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { SubHead } from "./SectionHead.tsx";

export const STATUS: Record<ChannelInfo["status"], "brand" | "neutral" | "warning" | "danger"> = {
  running: "brand",
  starting: "neutral",
  off: "neutral",
  error: "danger",
};

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

/** Who wrote and waits to be let in; on Telegram the owner can also link their own chat with its code. */
export function Pairing({ channelId, itsMe }: { channelId: string; itsMe: boolean }) {
  const t = useT();
  const all = useChannels((s) => s.pairing);
  const requests = useMemo(() => all.filter((r) => r.channel === channelId), [all, channelId]);
  const [code, setCode] = useState("");
  return (
    <>
      <SubHead>{t("tg.pairing")}</SubHead>
      {itsMe && (
        <SettingRow title={t("tg.itsMe")} description={t("tg.itsMeHint")}>
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
      )}
      {requests.length === 0 ? (
        <EmptyState variant="dashed" size="sm" icon={<Icons.Users />}>
          {t("tg.pairingEmpty")}
        </EmptyState>
      ) : (
        <ul className="chan__rows">
          {requests.map((r) => (
            <PairingRow key={r.code} request={r} />
          ))}
        </ul>
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
              <div className="res__desc">{o.text}</div>
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
  const quiet = Boolean(prefs.quiet_from && prefs.quiet_to);
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
      <SettingRow title={t("tg.quiet")} description={t("tg.quietHint")}>
        <div className="tgquiet">
          <Switch
            size="sm"
            checked={quiet}
            onCheckedChange={(on) =>
              void saveNotices(
                on
                  ? { ...prefs, quiet_from: "23:00", quiet_to: "08:00" }
                  : { inputs_after_s: prefs.inputs_after_s, ...(prefs.channel ? { channel: prefs.channel } : {}) },
              )
            }
            aria-label={t("tg.quiet")}
          />
          {quiet && (
            <>
              <span className="tgquiet__word">{t("tg.quietFrom")}</span>
              <Input
                aria-label={t("tg.quietFrom")}
                type="time"
                value={prefs.quiet_from ?? ""}
                onChange={(e) => void saveNotices({ ...prefs, quiet_from: e.currentTarget.value })}
              />
              <span className="tgquiet__word">{t("tg.quietTo")}</span>
              <Input
                aria-label={t("tg.quietTo")}
                type="time"
                value={prefs.quiet_to ?? ""}
                onChange={(e) => void saveNotices({ ...prefs, quiet_to: e.currentTarget.value })}
              />
            </>
          )}
        </div>
      </SettingRow>
    </>
  );
}
