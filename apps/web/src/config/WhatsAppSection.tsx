import type { ChannelInfo } from "@apx/protocol";
import { Badge, Button, Icons, SettingRow, Spinner, Switch } from "@apx/ui";
import { useEffect, useState } from "react";
import { KindTile } from "../channels/KindIcon.tsx";
import { AgentSelect } from "../common/pickers/AgentSelect.tsx";
import { QrCode } from "../common/QrCode.tsx";
import { type ChannelDraft, loadChannels, saveChannel, useChannels } from "../data/channels.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { Behavior, Deliveries, Notices, Pairing, People, STATUS } from "./ChannelParts.tsx";

const CHANNEL_ID = "whatsapp";
const DEFAULTS = { enabled: true, strangers: "pair", concurrency: "queue", owner_thread: "home" } as const;

/**
 * WhatsApp: the owner's own number, linked like WhatsApp Web with a QR. The owner writes to their agent in "Message
 * yourself"; others are answered only once approved.
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
      {channel?.status === "running" && (
        <>
          <Pairing channelId={channel.id} itsMe={false} />
          <Notices />
          <People channelId={channel.id} />
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
  const [busy, setBusy] = useState(false);
  const link = async () => {
    setBusy(true);
    await saveChannel(CHANNEL_ID, { agent_id: agent, ...DEFAULTS });
    setBusy(false);
  };
  return (
    <div className="tgsetup">
      <Steps />
      <SettingRow title={t("tg.agent")} description={t("tg.agentHint")}>
        <AgentSelect size="sm" className="tgagent" value={agent} onChange={(id) => id && setAgent(id)} />
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
      {running && <Behavior channel={channel} save={save} />}
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
