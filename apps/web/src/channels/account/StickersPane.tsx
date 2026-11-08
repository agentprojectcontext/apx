import type { ChannelInfo } from "@apx/protocol";
import { CHANNEL_DEFAULTS } from "@apx/protocol/client";
import { SettingRow, Switch } from "@apx/ui";
import { useT } from "../../i18n/index.ts";
import { CHANNEL_KINDS, isChannelKind } from "../kinds.ts";
import { Stickers } from "./Stickers.tsx";
import type { PaneProps } from "./types.ts";

/** Chat apps, where the agent may answer with an emoji (as a reaction, or as text where there are none). */
const CHATS = new Set<ChannelInfo["type"]>(["telegram", "whatsapp", "discord", "slack", "imessage"]);
/** Apps whose stickers the agent keeps and may send. */
const STICKERS = new Set<ChannelInfo["type"]>(["telegram", "whatsapp"]);

/** Whether the account has stickers and emoji to set: only chat apps do. */
export const hasStickersPane = (type: ChannelInfo["type"]) => CHATS.has(type);

/** Answers without words: an emoji on their message, and the stickers kept from the app (where it has them). */
export function StickersPane({ channel, draft, set }: PaneProps) {
  const t = useT();
  const reactions = draft.reactions ?? CHANNEL_DEFAULTS.reactions;
  return (
    <>
      <SettingRow title={t("ch.reactions")} description={t(reactions ? "ch.reactionsHint.on" : "ch.reactionsHint.off")}>
        <Switch
          size="sm"
          checked={reactions}
          onCheckedChange={(on) => set({ reactions: on })}
          aria-label={t("ch.reactions")}
        />
      </SettingRow>
      {STICKERS.has(channel.type) && isChannelKind(channel.type) && (
        <Stickers platform={channel.type} label={t(CHANNEL_KINDS[channel.type].name)} />
      )}
    </>
  );
}
