import type { ChannelInfo, Person } from "@apx/protocol";
import {
  AgentAvatar,
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
import { useEffect, useState } from "react";
import {
  type ChannelDraft,
  loadChannels,
  removePerson,
  respondPairing,
  saveChannel,
  saveNotices,
  setPersonRole,
  unlinkAddress,
  useChannels,
} from "../data/channels.ts";
import { blobOf } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { SubHead } from "./SectionHead.tsx";

const CHANNEL_ID = "telegram";

/** Telegram: connect a bot, choose who answers, approve who may write, see what was sent. */
export function TelegramSection() {
  const channels = useChannels((s) => s.channels);
  const ready = useChannels((s) => s.ready);
  useEffect(() => {
    void loadChannels();
    const id = setInterval(() => void loadChannels(), 5000);
    return () => clearInterval(id);
  }, []);
  const channel = channels.find((c) => c.type === "telegram");
  return (
    <>
      {ready && (channel ? <Connected channel={channel} /> : <Setup />)}
      {channel && <Pairing />}
      {channel && <Notices />}
      {channel && <People channelId={channel.id} />}
      {channel && <Deliveries channelId={channel.id} />}
    </>
  );
}

function AgentPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const agents = useData((s) => s.agents);
  const list = Object.values(agents).filter((a) => !a.project_id);
  const current = agents[value];
  return (
    <Menu
      align="end"
      trigger={
        <Button variant="secondary" size="sm" trailingIcon={<Icons.ChevronDown size={14} />}>
          {current && <AgentAvatar name={current.name} blob={blobOf(current)} size={16} animated={false} />}
          {current?.name ?? value}
        </Button>
      }
      items={list.map((a) => ({ label: a.name, onSelect: () => onChange(a.id) }))}
    />
  );
}

function Setup() {
  const t = useT();
  const agents = useData((s) => s.agents);
  const secretary = Object.values(agents).find((a) => a.kind === "secretary");
  const [token, setToken] = useState("");
  const [agent, setAgent] = useState(secretary?.id ?? "roby");
  const [busy, setBusy] = useState(false);
  const connect = async () => {
    setBusy(true);
    await saveChannel(
      CHANNEL_ID,
      { agent_id: agent, enabled: true, strangers: "pair", concurrency: "queue", owner_thread: "home" },
      token.trim(),
    );
    setBusy(false);
  };
  return (
    <div className="tgsetup">
      <ol className="tgsetup__steps">
        <li>{t("tg.step1")}</li>
        <li>{t("tg.step2")}</li>
        <li>{t("tg.step3")}</li>
      </ol>
      <div className="pform__field">
        <span className="pform__label">{t("tg.token")}</span>
        <Input
          aria-label={t("tg.token")}
          type="password"
          autoComplete="off"
          placeholder="123456789:AA…"
          value={token}
          onChange={(e) => setToken(e.currentTarget.value)}
        />
        <span className="pform__hint">{t("tg.tokenHint")}</span>
      </div>
      <SettingRow title={t("tg.agent")} description={t("tg.agentHint")}>
        <AgentPicker value={agent} onChange={setAgent} />
      </SettingRow>
      <div>
        <Button disabled={!/^\d+:[\w-]{20,}$/.test(token.trim())} loading={busy} onClick={() => void connect()}>
          {t("tg.connect")}
        </Button>
      </div>
    </div>
  );
}

const STATUS: Record<ChannelInfo["status"], "brand" | "neutral" | "warning" | "danger"> = {
  running: "brand",
  starting: "neutral",
  off: "neutral",
  error: "danger",
};

function Connected({ channel }: { channel: ChannelInfo }) {
  const t = useT();
  const [token, setToken] = useState("");
  const draft: ChannelDraft = {
    agent_id: channel.agent_id,
    enabled: channel.enabled,
    strangers: channel.strangers,
    concurrency: channel.concurrency,
    owner_thread: channel.owner_thread,
  };
  const save = (patch: Partial<ChannelDraft>, newToken?: string) =>
    saveChannel(channel.id, { ...draft, ...patch }, newToken);
  return (
    <>
      <div className="pcard tgcard">
        <div className="pcard__top">
          <span className="tgcard__icon">
            <Icons.Send size={18} />
          </span>
          <div className="pcard__titles">
            <div className="pcard__name">{channel.account ?? channel.label}</div>
            <div className="pcard__id">{t(`tg.status.${channel.status}`)}</div>
          </div>
          <Badge tone={STATUS[channel.status]} dot>
            {channel.enabled ? t(`tg.status.${channel.status}`) : t("providers.off")}
          </Badge>
          <Switch
            size="sm"
            checked={channel.enabled}
            onCheckedChange={(on) => void save({ enabled: on })}
            label={t("providers.on")}
          />
        </div>
        {channel.error && <div className="tgcard__error">{channel.error}</div>}
      </div>

      <SubHead>{t("tg.behavior")}</SubHead>
      <SettingRow title={t("tg.agent")} description={t("tg.agentHint")}>
        <AgentPicker value={channel.agent_id} onChange={(id) => void save({ agent_id: id })} />
      </SettingRow>
      <SettingRow title={t("tg.ownerThread")} description={t("tg.ownerThreadHint")}>
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
      <SettingRow title={t("tg.concurrency")} description={t("tg.concurrencyHint")}>
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
      <SettingRow title={t("tg.strangers")} description={t("tg.strangersHint")}>
        <SegmentedControl
          size="sm"
          label={t("tg.strangers")}
          value={channel.strangers}
          onValueChange={(v) => void save({ strangers: v as ChannelDraft["strangers"] })}
          options={[
            { value: "pair", label: t("tg.strangers.pair") },
            { value: "ignore", label: t("tg.strangers.ignore") },
          ]}
        />
      </SettingRow>
      <SettingRow title={t("tg.token")} description={t("tg.tokenChange")}>
        <div className="tgtoken">
          <Input
            aria-label={t("tg.token")}
            type="password"
            autoComplete="off"
            placeholder={t("providers.keyKeep")}
            value={token}
            onChange={(e) => setToken(e.currentTarget.value)}
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={!token.trim()}
            onClick={() => void save({}, token.trim()).then((ok) => ok && setToken(""))}
          >
            {t("common.save")}
          </Button>
        </div>
      </SettingRow>
      <div className="tgremove">
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<Icons.Trash2 size={14} />}
          onClick={() => void saveChannel(channel.id, null)}
        >
          {t("tg.remove")}
        </Button>
      </div>
    </>
  );
}

function Pairing() {
  const t = useT();
  const requests = useChannels((s) => s.pairing);
  const [code, setCode] = useState("");
  return (
    <>
      <SubHead>{t("tg.pairing")}</SubHead>
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
      {requests.length === 0 ? (
        <EmptyState variant="dashed" size="sm" icon={<Icons.Users />}>
          {t("tg.pairingEmpty")}
        </EmptyState>
      ) : (
        <ul className="res__list">
          {requests.map((r) => (
            <li key={r.code} className="res__row">
              <div className="res__main">
                <div className="res__name">{r.name}</div>
                {r.text && <div className="res__desc">“{r.text}”</div>}
              </div>
              <Button size="sm" variant="secondary" onClick={() => void respondPairing(r.code, "contact")}>
                {t("tg.asContact")}
              </Button>
              <IconButton
                size="sm"
                label={t("tg.ignore")}
                icon={<Icons.X size={14} />}
                onClick={() => void respondPairing(r.code, "deny")}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function People({ channelId }: { channelId: string }) {
  const t = useT();
  const all = useChannels((s) => s.persons);
  const persons = all.filter((p) => p.addresses.some((a) => a.channel === channelId));
  if (!persons.length) return null;
  return (
    <>
      <SubHead>{t("tg.people")}</SubHead>
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

function Deliveries({ channelId }: { channelId: string }) {
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
function Notices() {
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
