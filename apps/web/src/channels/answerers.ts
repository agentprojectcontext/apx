import type { Agent, ChannelInfo } from "@apx/protocol";
import type { T } from "../i18n/index.ts";

/** Who answers on an account: the agent the owner talks to, and the one for contacts only when it is another. */
export type Answerers = { owner: Agent | undefined; contacts: { agent: Agent | undefined } | undefined };

export function answerersOf(channel: ChannelInfo, agents: Record<string, Agent>): Answerers {
  const contactsId = channel.contacts_agent_id;
  return {
    owner: agents[channel.agent_id],
    contacts: contactsId && contactsId !== channel.agent_id ? { agent: agents[contactsId] } : undefined,
  };
}

/** The agent's name, or words for one that was removed; lowercase so it reads inside a sentence. */
export const agentName = (agent: Agent | undefined, t: T): string => agent?.name ?? t("ch.agentGone");

/** A text that may start with a placeholder name, with its first letter capital. */
export const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** One line: who answers, or who the owner talks to and who answers the contacts. */
export function answersLine(a: Answerers, t: T): string {
  const agent = agentName(a.owner, t);
  if (!a.contacts) return sentence(t("ch.answersBy", { agent }));
  return sentence(t("ch.answersSplit", { agent, contacts: agentName(a.contacts.agent, t) }));
}
