import type { ChannelInfo } from "@apx/protocol";
import { Badge, EmptyState, Icons, SettingRow, Switch } from "@apx/ui";
import { useEffect, useState } from "react";
import { KindTile } from "../channels/KindIcon.tsx";
import { AgentSelect } from "../common/pickers/AgentSelect.tsx";
import { type ChannelDraft, loadChannels, saveChannel, setIMessage, useChannels } from "../data/channels.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { Behavior, Deliveries, Notices, Pairing, People, STATUS } from "./ChannelParts.tsx";

/**
 * iMessage on this Mac, two ways: tools agents use (read recent messages, send one with your OK), and a channel that
 * answers the people who write, once you approve them. Each is off until the owner turns it on; only a Mac has them.
 */
export function IMessageSection() {
  const t = useT();
  const im = useChannels((s) => s.imessage);
  const channel = useChannels((s) => s.channels.find((c) => c.type === "imessage"));
  useEffect(() => {
    void loadChannels();
    const id = setInterval(() => void loadChannels(), 5000);
    return () => clearInterval(id);
  }, []);
  if (!im) return null;
  if (!im.available)
    return (
      <div className="channelcfg">
        <KindTile kind="imessage" size={40} />
        <EmptyState variant="dashed" icon={<Icons.Monitor />} title={t("im.onlyMac")}>
          {t("im.onlyMacBody")}
        </EmptyState>
      </div>
    );
  return (
    <>
      <SettingRow title={t("im.toggle")} description={t("im.toggleHint")}>
        <Switch checked={im.on} onCheckedChange={(on) => void setIMessage(on)} aria-label={t("im.toggle")} />
      </SettingRow>
      {channel ? <Answering channel={channel} /> : <StartAnswering />}
      <ol className="tgsetup__steps">
        <li>{t("im.step1")}</li>
        <li>{t("im.step2")}</li>
      </ol>
      {channel && (
        <Pairing
          channelId={channel.id}
          itsMe={{ title: t("tg.itsMe", { channel: "iMessage" }), hint: t("tg.itsMeHint", { channel: "iMessage" }) }}
        />
      )}
      {channel && <Notices />}
      {channel && <People channelId={channel.id} />}
      {channel && <Deliveries channelId={channel.id} />}
    </>
  );
}

/** Turns the channel on, answered by the chosen agent (the secretary by default). */
function StartAnswering() {
  const t = useT();
  const agents = useData((s) => s.agents);
  const secretary = Object.values(agents).find((a) => a.kind === "secretary");
  const [agent, setAgent] = useState(secretary?.id ?? "roby");
  return (
    <>
      <SettingRow title={t("im.answer")} description={t("im.answerHint")}>
        <Switch
          checked={false}
          aria-label={t("im.answer")}
          onCheckedChange={(on) =>
            on &&
            void saveChannel("imessage", {
              agent_id: agent,
              enabled: true,
              strangers: "pair",
              concurrency: "steer",
              owner_thread: "home",
            })
          }
        />
      </SettingRow>
      <SettingRow title={t("tg.agent")} description={t("tg.agentHint", { channel: "iMessage" })}>
        <AgentSelect size="sm" className="tgagent" value={agent} onChange={(id) => id && setAgent(id)} />
      </SettingRow>
    </>
  );
}

function Answering({ channel }: { channel: ChannelInfo }) {
  const t = useT();
  const draft: ChannelDraft = {
    agent_id: channel.agent_id,
    enabled: channel.enabled,
    strangers: channel.strangers,
    concurrency: channel.concurrency,
    owner_thread: channel.owner_thread,
    closers: channel.closers,
    research: channel.research,
  };
  const save = (patch: Partial<ChannelDraft>) => saveChannel(channel.id, { ...draft, ...patch });
  return (
    <>
      <SettingRow title={t("im.answer")} description={channel.error ?? t("im.answerHint")}>
        <Badge tone={STATUS[channel.status]} dot>
          {channel.enabled ? t(`tg.status.${channel.status}`) : t("providers.off")}
        </Badge>
        <Switch
          checked={channel.enabled}
          aria-label={t("im.answer")}
          onCheckedChange={(on) => void (on ? save({ enabled: true }) : saveChannel(channel.id, null))}
        />
      </SettingRow>
      <Behavior channel={channel} save={save} />
    </>
  );
}
