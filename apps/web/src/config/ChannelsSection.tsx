import { Button, EmptyState, Icons, Menu, SegmentedControl } from "@apx/ui";
import { useEffect } from "react";
import { addChannelItems } from "../channels/KindIcon.tsx";
import { CHANNEL_KIND_IDS, CHANNEL_KINDS, isChannelKind } from "../channels/kinds.ts";
import { loadChannels, useChannels } from "../data/channels.ts";
import { useT } from "../i18n/index.ts";
import { go, useNav } from "../shell/nav.ts";
import { ChannelSoon } from "./OtherSections.tsx";
import { SectionHead } from "./SectionHead.tsx";
import { TelegramSection } from "./TelegramSection.tsx";

/** Config › Channels: a tab per connected channel, and "+" for the kinds not connected yet. */
export function ChannelsSection() {
  const t = useT();
  const channels = useChannels((s) => s.channels);
  const picked = useNav((s) => s.configChannel);
  useEffect(() => {
    void loadChannels();
  }, []);
  const connected = CHANNEL_KIND_IDS.filter((k) => channels.some((c) => c.type === k));
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
        lead={current ? t(current === "telegram" ? "tg.lead" : CHANNEL_KINDS[current].text) : t("channels.lead")}
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
      ) : current === "telegram" ? (
        <TelegramSection />
      ) : (
        <ChannelSoon channel={current} />
      )}
    </>
  );
}
