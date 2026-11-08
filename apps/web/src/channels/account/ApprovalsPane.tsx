import type { ChannelInfo } from "@apx/protocol";
import { EmptyState, Icons, SegmentedControl, SettingRow } from "@apx/ui";
import { useMemo } from "react";
import { type ChannelDraft, useChannels } from "../../data/channels.ts";
import { type MessageKey, useT } from "../../i18n/index.ts";
import { PairingRow } from "../StartRows.tsx";
import type { PaneProps } from "./types.ts";

/** On the owner's own WhatsApp number a stranger never gets a code from it: "pair" only lists them. */
const listsOnly = (c: Pick<ChannelInfo, "type" | "self_owner">) => c.type === "whatsapp" && c.self_owner === true;
const HINT: Record<ChannelInfo["strangers"] | "list", MessageKey> = {
  pair: "ch.strangersHint.pair",
  list: "ch.strangersHint.list",
  ask: "ch.strangersHint.ask",
  answer: "ch.strangersHint.answer",
  ignore: "ch.strangersHint.ignore",
};

/** What someone new gets when they write, and who wrote and waits to be let in. */
export function ApprovalsPane({ channel, draft, set }: PaneProps) {
  const t = useT();
  const all = useChannels((s) => s.pairing);
  const requests = useMemo(() => all.filter((r) => r.channel === channel.id), [all, channel.id]);
  const lists = listsOnly({ type: channel.type, self_owner: draft.self_owner });
  return (
    <>
      <SettingRow
        title={t("tg.strangers")}
        description={t(HINT[draft.strangers === "pair" && lists ? "list" : draft.strangers])}
      >
        <SegmentedControl
          size="sm"
          label={t("tg.strangers")}
          value={draft.strangers}
          onValueChange={(v) => set({ strangers: v as ChannelDraft["strangers"] })}
          options={[
            { value: "pair", label: t(lists ? "ch.strangers.list" : "tg.strangers.pair") },
            { value: "ask", label: t("ch.strangers.ask") },
            { value: "answer", label: t("ch.strangers.answer") },
            { value: "ignore", label: t("tg.strangers.ignore") },
          ]}
        />
      </SettingRow>
      {requests.length ? (
        <ul className="chan__rows acct__pending">
          {requests.map((r) => (
            <PairingRow key={r.code} request={r} />
          ))}
        </ul>
      ) : (
        <EmptyState variant="dashed" size="sm" icon={<Icons.Check />}>
          {t("acct.noApprovals")}
        </EmptyState>
      )}
    </>
  );
}
