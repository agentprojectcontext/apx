import type { ChannelInfo } from "@apx/protocol";
import { Badge, Button, EmptyState, IconButton, Icons, SettingRow, Spinner, Switch } from "@apx/ui";
import { useEffect, useMemo, useState } from "react";
import { KindTile } from "../channels/KindIcon.tsx";
import { PhoneForm, phoneOf } from "../channels/PhoneForm.tsx";
import { AgentSelect } from "../common/pickers/AgentSelect.tsx";
import { QrCode } from "../common/QrCode.tsx";
import { type ChannelDraft, loadChannels, saveChannel, unlinkAddress, useChannels } from "../data/channels.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { Behavior, Deliveries, Notices, Pairing, People, STATUS } from "./ChannelParts.tsx";
import { SubHead } from "./SectionHead.tsx";
import { Stickers } from "./StickersSection.tsx";

const CHANNEL_ID = "whatsapp";
const DEFAULTS = { enabled: true, strangers: "pair", concurrency: "steer", owner_thread: "home" } as const;

/**
 * WhatsApp, linked like WhatsApp Web with a QR: a line of its own the owner writes to from their phone, or the owner's
 * own number (they write in "Message yourself"). Others are answered only once approved.
 */
export function WhatsAppSection() {
  const channels = useChannels((s) => s.channels);
  const ready = useChannels((s) => s.ready);
  const channel = channels.find((c) => c.type === "whatsapp");
  // While a QR waits it changes every few seconds: read it often then, rarely otherwise.
  const linking = channel?.status === "starting";
  useEffect(() => {
    void loadChannels();
    const id = setInterval(() => void loadChannels(), linking ? 1500 : 5000);
    return () => clearInterval(id);
  }, [linking]);
  return (
    <>
      {ready && (channel ? <Linked channel={channel} /> : <Setup />)}
      {channel && (
        <>
          {!channel.self_owner && <OwnerPhone channel={channel} />}
          <Pairing channelId={channel.id} />
          <Notices />
          <People channelId={channel.id} />
          <Stickers platform="whatsapp" label={channel.label} />
          <Deliveries channelId={channel.id} />
        </>
      )}
    </>
  );
}

function Steps() {
  const t = useT();
  return (
    <ol className="tgsetup__steps">
      <li>{t("wa.step1")}</li>
      <li>{t("wa.step2")}</li>
      <li>{t("wa.step3")}</li>
    </ol>
  );
}

function Setup() {
  const t = useT();
  const agents = useData((s) => s.agents);
  const secretary = Object.values(agents).find((a) => a.kind === "secretary");
  const [agent, setAgent] = useState(secretary?.id ?? "roby");
  const [selfOwner, setSelfOwner] = useState(false);
  const [busy, setBusy] = useState(false);
  const link = async () => {
    setBusy(true);
    await saveChannel(CHANNEL_ID, { agent_id: agent, ...DEFAULTS, self_owner: selfOwner });
    setBusy(false);
  };
  return (
    <div className="tgsetup">
      <Steps />
      <SettingRow title={t("tg.agent")} description={t("tg.agentHint", { channel: "WhatsApp" })}>
        <AgentSelect size="sm" className="tgagent" value={agent} onChange={(id) => id && setAgent(id)} />
      </SettingRow>
      <SettingRow title={t("ch.selfOwner")} description={t("ch.selfOwnerHint")}>
        <Switch size="sm" checked={selfOwner} onCheckedChange={setSelfOwner} aria-label={t("ch.selfOwner")} />
      </SettingRow>
      <div>
        <Button loading={busy} leadingIcon={<Icons.QrCode size={14} />} onClick={() => void link()}>
          {t("wa.link")}
        </Button>
      </div>
    </div>
  );
}

function Linked({ channel }: { channel: ChannelInfo }) {
  const t = useT();
  const draft: ChannelDraft = {
    agent_id: channel.agent_id,
    enabled: channel.enabled,
    strangers: channel.strangers,
    concurrency: channel.concurrency,
    owner_thread: channel.owner_thread,
    self_owner: channel.self_owner,
    closers: channel.closers,
    research: channel.research,
    hours: channel.hours,
  };
  const save = (patch: Partial<ChannelDraft>) => saveChannel(channel.id, { ...draft, ...patch });
  const running = channel.status === "running";
  const state = channel.qr ? t("wa.waitingScan") : t(`tg.status.${channel.status}`);
  return (
    <>
      <div className="pcard tgcard">
        <div className="pcard__top">
          <span className={`tgcard__tile${running ? "" : " is-idle"}`}>
            <KindTile kind="whatsapp" />
          </span>
          <div className="pcard__titles">
            <div className="pcard__name">{channel.account ?? channel.label}</div>
            <div className="pcard__id">{state}</div>
          </div>
          <Badge tone={STATUS[channel.status]} dot>
            {channel.enabled ? state : t("providers.off")}
          </Badge>
          <Switch
            size="sm"
            checked={channel.enabled}
            onCheckedChange={(on) => void save({ enabled: on })}
            label={t("providers.on")}
          />
        </div>
        {channel.error && <div className="tgcard__error">{channel.error}</div>}
        {channel.status === "starting" &&
          (channel.qr ? (
            <div className="waqr">
              <QrCode value={channel.qr} label={t("wa.scan")} />
              <div className="waqr__text">
                <b>{t("wa.scan")}</b>
                <Steps />
                <span className="waqr__hint">{t("wa.scanHint")}</span>
              </div>
            </div>
          ) : (
            <div className="waqr__wait">
              <Spinner size={14} /> {t("wa.connecting")}
            </div>
          ))}
        {channel.status === "error" && (
          <div>
            <Button size="sm" leadingIcon={<Icons.QrCode size={14} />} onClick={() => void save({})}>
              {t("wa.relink")}
            </Button>
          </div>
        )}
      </div>
      <SettingRow title={t("ch.selfOwner")} description={t("ch.selfOwnerHint")}>
        <Switch
          size="sm"
          checked={channel.self_owner === true}
          onCheckedChange={(on) => void save({ self_owner: on })}
          aria-label={t("ch.selfOwner")}
        />
      </SettingRow>
      <Behavior channel={channel} save={save} />
      <div className="tgremove">
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<Icons.Trash2 size={14} />}
          onClick={() => void saveChannel(channel.id, null)}
        >
          {t("wa.remove")}
        </Button>
      </div>
    </>
  );
}

/** On a line of its own, the owner's phone: the numbers that are theirs, and one typed by hand. */
function OwnerPhone({ channel }: { channel: ChannelInfo }) {
  const t = useT();
  const owner = useChannels((s) => s.persons.find((p) => p.role === "owner"));
  const mine = useMemo(() => owner?.addresses.filter((a) => a.channel === channel.id), [owner, channel.id]);
  return (
    <>
      <SubHead>{t("ch.phone")}</SubHead>
      {mine?.length ? (
        <ul className="res__list">
          {mine.map((a) => (
            <li key={a.id} className="res__row">
              <Icons.Smartphone size={14} className="res__icon" />
              <div className="res__main">
                <div className="res__name">{phoneOf(a.external_id)}</div>
              </div>
              <IconButton
                size="sm"
                label={t("ch.phoneRemove")}
                icon={<Icons.X size={14} />}
                onClick={() => void unlinkAddress(a.id)}
              />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState variant="dashed" size="sm" icon={<Icons.Smartphone />}>
          {t("ch.phoneNone")}
        </EmptyState>
      )}
      <SettingRow title={t("ch.phoneAdd")} description={t("ch.phoneAddHint")}>
        <PhoneForm channelId={channel.id} />
      </SettingRow>
    </>
  );
}
