import "../styles/screens.css";
import type { ChannelInfo, RoomMode, Thread } from "@apx/protocol";
import { Button, Icons, SegmentedControl, Textarea, Tooltip } from "@apx/ui";
import { useState } from "react";
import { AgentSelect } from "../common/pickers/AgentSelect.tsx";
import { draftOf, saveChannel } from "../data/channels.ts";
import { notify } from "../data/notices.ts";
import { useData } from "../data/state.ts";
import { usePack, useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { CardField, ChatCard } from "./ChatCard.tsx";
import { ChoiceChips } from "./ChoiceChips.tsx";
import { isChannelKind, roomsWord, roomWord } from "./kinds.ts";

const MODES: RoomMode[] = ["mention", "useful", "always", "read"];
/**
 * A group's or a room's card beside its chat: who answers there (the account's contacts agent or one of its own), when
 * the agent speaks there, and the rules for every room of the account (the same ones its Rooms settings keep).
 */
export function RoomPanel({ thread, channel, onClose }: { thread: Thread; channel: ChannelInfo; onClose(): void }) {
  const t = useT();
  // The modes' explanations are the account settings' own words.
  const hints = usePack("account");
  const rooms = channel.rooms;
  const room = rooms?.rooms.find((r) => r.id === thread.channel?.conversation);
  const [mode, setMode] = useState<RoomMode | undefined>(room?.mode);
  const [rules, setRules] = useState(rooms?.rules ?? "");
  const [agentId, setAgentId] = useState(room?.agent_id);
  const [other, setOther] = useState(Boolean(room?.agent_id));
  const accountAgent = useData((s) => s.agents[channel.contacts_agent_id ?? channel.agent_id]);
  const [busy, setBusy] = useState(false);
  const group = roomsWord(channel.type) === "groups";
  const kind = isChannelKind(channel.type) ? channel.type : undefined;
  const ownAgent = other ? agentId : undefined;
  const dirty = mode !== room?.mode || rules !== (rooms?.rules ?? "") || ownAgent !== room?.agent_id;
  const save = async () => {
    if (!rooms || !room || !mode) return;
    setBusy(true);
    const next = { id: room.id, name: room.name, mode, ...(ownAgent ? { agent_id: ownAgent } : {}) };
    const ok = await saveChannel(channel.id, {
      ...draftOf(channel),
      rooms: { ...rooms, rules, rooms: rooms.rooms.map((r) => (r.id === room.id ? next : r)) },
    });
    setBusy(false);
    if (ok) notify(t("ch.saved.room"), "info");
  };
  return (
    <ChatCard
      className="chan__card--room"
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
            <Button
              size="sm"
              disabled={!dirty || !room || (other && !agentId)}
              loading={busy}
              onClick={() => void save()}
            >
              {t("common.save")}
            </Button>
          </Tooltip>
        </>
      }
    >
      {room && mode ? (
        <>
          <CardField
            label={t("ch.answers")}
            hint={other ? t("room.card.answersHint", { name: thread.title }) : undefined}
          >
            <SegmentedControl
              size="sm"
              className="chan__answers"
              label={t("ch.answers")}
              value={other ? "other" : "account"}
              onValueChange={(v) => setOther(v === "other")}
              options={[
                { value: "account", label: t("ch.answers.account", { agent: accountAgent?.name ?? "" }) },
                { value: "other", label: t("ch.answers.other") },
              ]}
            />
            {other && (
              <AgentSelect
                size="sm"
                channel
                label={t("room.card.answersPick", { name: thread.title })}
                value={agentId}
                onChange={(id) => id && setAgentId(id)}
              />
            )}
          </CardField>
          <CardField
            label={t(group ? "room.card.speaksGroup" : "room.card.speaks")}
            hint={hints ? t(`rooms.modeHint.${mode}`) : undefined}
          >
            <ChoiceChips
              label={t(group ? "room.card.speaksGroup" : "room.card.speaks")}
              value={mode}
              onChange={(v) => setMode(MODES.find((m) => m === v) ?? mode)}
              options={MODES.map((m) => ({
                value: m,
                label: t(`rooms.mode.${m}`),
                hint: hints ? t(`rooms.modeHint.${m}`) : "",
              }))}
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
