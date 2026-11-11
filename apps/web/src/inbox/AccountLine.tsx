import type { Agent, Thread } from "@apx/protocol";
import { AnswersLine } from "../channels/AnswersLine.tsx";
import { ContactFlags, useContactFlags } from "../channels/flags.tsx";
import { RELATION_KEY } from "../channels/people.ts";
import { useChannels } from "../data/channels.ts";
import { useT } from "../i18n/index.ts";

/** Under it, who they are to the owner and who answers them ("Associate · Roby answers"), with what is set for them. */
export function AccountLine({ thread, agent }: { thread: Thread; agent: Agent | undefined }) {
  const t = useT();
  const person = useChannels((s) => s.persons.find((p) => p.id === thread.channel?.person_id));
  const relation = person?.relation ? t(RELATION_KEY[person.relation]) : undefined;
  const flags = useContactFlags(person, thread.channel?.id ?? "");
  return (
    <span className="threadrow__line">
      {thread.state === "input-required" && <span className="threadrow__waiting">{t("thread.waiting")} · </span>}
      <AnswersLine className="threadrow__who" lead={[relation]} agent={agent} />
      <ContactFlags flags={flags} />
    </span>
  );
}
