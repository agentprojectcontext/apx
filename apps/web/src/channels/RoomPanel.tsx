import type { ChannelInfo, RoomMode, Thread } from "@apx/protocol";
import { Button, Icons, Textarea, Tooltip } from "@apx/ui";
import { useState } from "react";
import { draftOf, saveChannel } from "../data/channels.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { CardField, ChatCard } from "./ChatCard.tsx";
import { ChoiceChips } from "./ChoiceChips.tsx";
import { GROUP_KINDS, isChannelKind, roomWord } from "./kinds.ts";

const MODES: RoomMode[] = ["mention", "useful", "always", "read"];
/**
 * A group's or a room's card beside its chat: when the agent speaks there, and the rules for every room of the account
 * (the same ones its Rooms settings keep).
 */
export function RoomPanel({ thread, channel, onClose }: { thread: Thread; channel: ChannelInfo; onClose(): void }) {
  const t = useT();
  const rooms = channel.rooms;
  const room = rooms?.rooms.find((r) => r.id === thread.channel?.conversation);
  const [mode, setMode] = useState<RoomMode | undefined>(room?.mode);
  const [rules, setRules] = useState(rooms?.rules ?? "");
  const [busy, setBusy] = useState(false);
  const group = GROUP_KINDS.has(channel.type);
  const kind = isChannelKind(channel.type) ? channel.type : undefined;
  const dirty = mode !== room?.mode || rules !== (rooms?.rules ?? "");
  const save = async () => {
    if (!rooms || !room || !mode) return;
    setBusy(true);
    const ok = await saveChannel(channel.id, {
      ...draftOf(channel),
      rooms: { ...rooms, rules, rooms: rooms.rooms.map((r) => (r.id === room.id ? { ...r, mode } : r)) },
    });
    setBusy(false);
    if (ok) notify(t("ch.saved.room"), "info");
  };
  return (
    <ChatCard
      title={t(roomWord(channel))}
      channel={channel}
      name={thread.title}
      avatar={
        <span className="chan__cardavatar" aria-hidden>
          {group ? <Icons.Users size={20} /> : <Icons.Hash size={20} />}
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <span className="chan__spacer" />
          <Tooltip content={t("room.card.saveHint")}>
            <Button size="sm" disabled={!dirty || !room} loading={busy} onClick={() => void save()}>
              {t("common.save")}
            </Button>
          </Tooltip>
        </>
      }
    >
      {room && mode ? (
        <>
          <CardField label={t(group ? "room.card.speaksGroup" : "room.card.speaks")} hint={t(`rooms.modeHint.${mode}`)}>
            <ChoiceChips
              label={t(group ? "room.card.speaksGroup" : "room.card.speaks")}
              value={mode}
              onChange={(v) => setMode(MODES.find((m) => m === v) ?? mode)}
              options={MODES.map((m) => ({ value: m, label: t(`rooms.mode.${m}`), hint: t(`rooms.modeHint.${m}`) }))}
            />
          </CardField>
          <CardField label={t("ch.rules")} hint={t("room.card.rulesHint", { account: channel.label })}>
            <Textarea
              aria-label={t("ch.rules")}
              rows={3}
              maxLength={2000}
              placeholder={t("room.card.rulesPlaceholder")}
              value={rules}
              onChange={(e) => setRules(e.currentTarget.value)}
            />
          </CardField>
        </>
      ) : (
        <div className="chan__cardgone">
          <p className="pform__hint">{t("room.card.gone")}</p>
          {kind && (
            <Tooltip content={t("room.card.addAgain")}>
              <Button size="sm" variant="secondary" onClick={() => go.channelSettings(kind, channel.id, "rooms")}>
                {t("room.card.addAgain")}
              </Button>
            </Tooltip>
          )}
        </div>
      )}
    </ChatCard>
  );
}
