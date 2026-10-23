import { Button, EmptyState, Icons, Menu, SegmentedControl } from "@apx/ui";
import { useEffect } from "react";
import { addChannelItems } from "../channels/KindIcon.tsx";
import { CHANNEL_KIND_IDS, CHANNEL_KINDS, type ChannelKind, isChannelKind } from "../channels/kinds.ts";
import { loadChannels, useChannels } from "../data/channels.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { go, useNav } from "../shell/nav.ts";
import { BotSection, isBotKind } from "./BotSection.tsx";
import { EmailSection } from "./EmailSection.tsx";
import { IMessageSection } from "./IMessageSection.tsx";
import { ChannelSoon } from "./OtherSections.tsx";
import { SectionHead } from "./SectionHead.tsx";
import { WhatsAppSection } from "./WhatsAppSection.tsx";

const LEAD: Partial<Record<ChannelKind, MessageKey>> = {
  telegram: "tg.lead",
  whatsapp: "wa.lead",
  discord: "dc.lead",
  slack: "sl.lead",
  matrix: "mx.lead",
  mattermost: "mm.lead",
  signal: "sg.lead",
  imessage: "im.lead",
  email: "em.lead",
  googlechat: "gc.lead",
  sms: "sms.lead",
  ntfy: "nt.lead",
  nextcloud: "nc.lead",
  irc: "irc.lead",
  twitch: "tw.lead",
  teams: "tm.lead",
  line: "ln.lead",
};

/** Config › Channels: a tab per connected channel, and "+" for the kinds not connected yet. */
export function ChannelsSection() {
  const t = useT();
  const channels = useChannels((s) => s.channels);
  const picked = useNav((s) => s.configChannel);
  useEffect(() => {
    void loadChannels();
  }, []);
  const imessageOn = useChannels((s) => s.imessage?.on === true);
  const connected = CHANNEL_KIND_IDS.filter(
    (k) => channels.some((c) => c.type === k) || (k === "imessage" && imessageOn),
  );
  const current = picked ?? connected[0];
  // The kind being set up shows as a tab next to the connected ones until it is connected.
  const tabs = current && !connected.includes(current) ? [...connected, current] : connected;
  const missing = CHANNEL_KIND_IDS.filter((k) => !tabs.includes(k));

  const add = missing.length > 0 && (
    <Menu
      align="end"
      trigger={
        <Button variant="secondary" size="sm" leadingIcon={<Icons.Plus size={14} />}>
          {t("channels.add")}
        </Button>
      }
      items={addChannelItems(tabs, t, go.channelConfig)}
    />
  );

  return (
    <>
      <SectionHead
        title={t("config.channels")}
        lead={current ? t(LEAD[current] ?? CHANNEL_KINDS[current].text) : t("channels.lead")}
        actions={add || undefined}
      />
      {tabs.length > 0 && current && (
        <SegmentedControl
          size="sm"
          className="channels__tabs"
          label={t("config.channels")}
          value={current}
          onValueChange={(v) => isChannelKind(v) && go.channelConfig(v)}
          options={tabs.map((k) => ({ value: k, label: t(CHANNEL_KINDS[k].name) }))}
        />
      )}
      {!current ? (
        <EmptyState variant="dashed" icon={<Icons.MessageCircle />} title={t("channels.empty")}>
          {t("channels.emptyBody")}
        </EmptyState>
      ) : isBotKind(current) ? (
        <BotSection kind={current} />
      ) : current === "whatsapp" ? (
        <WhatsAppSection />
      ) : current === "imessage" ? (
        <IMessageSection />
      ) : current === "email" ? (
        <EmailSection />
      ) : (
        <ChannelSoon channel={current} />
      )}
    </>
  );
}
