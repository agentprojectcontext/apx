import { AgentGrid, SegmentedControl, SettingRow } from "@apx/ui";
import { useMemo } from "react";
import { AgentSelect } from "../../common/pickers/AgentSelect.tsx";
import { channelAgents } from "../../common/pickers/agents.ts";
import { SubHead } from "../../config/SectionHead.tsx";
import type { ChannelDraft } from "../../data/channels.ts";
import { blobOf } from "../../data/identity.ts";
import { useData } from "../../data/state.ts";
import { useT } from "../../i18n/index.ts";
import type { PaneProps } from "./types.ts";

/**
 * Who answers: the agent the owner talks to here (the super-agent or a project's head), where the owner's words go
 * (Home is the super-agent's conversation, so another agent answers in this account's own chat), and who answers the
 * contacts and rooms.
 */
export function AnswerPane({ channel, draft, set }: PaneProps) {
  const t = useT();
  const agents = useData((s) => s.agents);
  const list = useMemo(() => channelAgents(Object.values(agents), draft.agent_id), [agents, draft.agent_id]);
  const home = agents[draft.agent_id]?.kind === "secretary";
  return (
    <>
      <SubHead>{t("tg.ownerAgent")}</SubHead>
      <AgentGrid
        label={t("tg.ownerAgent")}
        value={draft.agent_id}
        onValueChange={(id) => set({ agent_id: id })}
        moreLabel={(n) => t("acct.moreAgents", { n })}
        lessLabel={t("acct.fewerAgents")}
        agents={list.map((a) => ({
          id: a.id,
          name: a.name,
          role: a.kind === "secretary" ? t("agent.super") : a.role,
          blob: blobOf(a),
        }))}
      />
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
