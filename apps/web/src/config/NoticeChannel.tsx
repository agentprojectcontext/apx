import { noticeChannelChoice } from "@apx/protocol/notices";
import { Select } from "@apx/ui";
import { useEffect } from "react";
import { loadChannels, saveNotices, useChannels } from "../data/channels.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";

/**
 * Which chat app the super-agent also writes to unasked (routine news, confirmations, reminders): one of the accounts it
 * answers, none, or the first of them that knows the owner. The app and paired phones are told either way. If the chosen channel refuses
 * a message, the core tries the next.
 */
export function NoticeChannelSelect({ label }: { label: string }) {
  const t = useT();
  const prefs = useChannels((s) => s.notices);
  const all = useChannels((s) => s.channels);
  const agents = useData((s) => s.agents);
  // Notices are the super-agent's words: only an account it answers carries them.
  const channels = all.filter((c) => agents[c.agent_id]?.kind === "secretary");
  useEffect(() => {
    void loadChannels();
  }, []);
  if (!prefs) return null;
  const chosen = noticeChannelChoice(prefs.channel);
  const value = chosen === "auto" || chosen === "none" || channels.some((c) => c.id === chosen) ? chosen : "auto";
  return (
    <Select
      label={label}
      value={value}
      onValueChange={(v) => void saveNotices({ ...prefs, channel: v && v !== "auto" ? v : undefined })}
      options={[
        { value: "auto", label: t("nudge.whereAuto") },
        ...channels.map((c) => ({ value: c.id, label: c.account ? `${c.label} · ${c.account}` : c.label })),
        { value: "none", label: t("nudge.whereNone") },
      ]}
    />
  );
}
