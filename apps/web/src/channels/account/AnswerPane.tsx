import { channelKindRules } from "@apx/protocol/client";
import { SegmentedControl, SettingRow } from "@apx/ui";
import { AgentSelect } from "../../common/pickers/AgentSelect.tsx";
import type { ChannelDraft } from "../../data/channels.ts";
import { useData } from "../../data/state.ts";
import { useT } from "../../i18n/index.ts";
import type { PaneProps } from "./types.ts";

/**
 * Who answers: the agent the owner talks to here (the super-agent, always first, or a project's head, found by project
 * in the picker), where the owner's words go (Home is the super-agent's conversation, so another agent answers in this
 * account's own chat), and who answers the contacts and rooms.
 */
export function AnswerPane({ channel, draft, set }: Pick<PaneProps, "channel" | "draft" | "set">) {
  const t = useT();
  const home = useData((s) => s.agents[draft.agent_id]?.kind === "secretary");
  // A kind that fixes where the owner's words go (email: each mail in the account's own chat) offers no choice.
  const fixed = channelKindRules(channel.type).ownerThread;
  return (
    <>
      <SettingRow title={t("tg.ownerAgent")} description={t("tg.ownerAgentHint", { channel: channel.label })}>
        <AgentSelect
          size="sm"
          className="tgagent"
          channel
          value={draft.agent_id}
          onChange={(id) => id && set({ agent_id: id })}
        />
      </SettingRow>
      {!fixed && (
        <SettingRow
          title={t("tg.ownerThread")}
          description={home ? t("tg.ownerThreadHint", { channel: channel.label }) : t("tg.ownerThreadOwnOnly")}
        >
          <SegmentedControl
            size="sm"
            label={t("tg.ownerThread")}
            disabled={!home}
            value={home ? draft.owner_thread : "own"}
            onValueChange={(v) => set({ owner_thread: v as ChannelDraft["owner_thread"] })}
            options={[
              { value: "home", label: t("tg.ownerThread.home") },
              { value: "own", label: t("tg.ownerThread.own") },
            ]}
          />
        </SettingRow>
      )}
      <SettingRow title={t("tg.contactsAgent")} description={t("tg.contactsAgentHint", { channel: channel.label })}>
        <AgentSelect
          size="sm"
          className="tgagent"
          channel
          value={draft.contacts_agent_id ?? draft.agent_id}
          onChange={(id) => id && set({ contacts_agent_id: id })}
        />
      </SettingRow>
    </>
  );
}
