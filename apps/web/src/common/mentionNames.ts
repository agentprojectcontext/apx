import type { Agent } from "@apx/protocol";

const MENTION = /(^|[^\p{L}\p{N}_@])@([\p{L}\p{N}_-]+)/gu;

/** The agent an `@token` names: by its id, or by its slug when only one agent has it. */
function mentioned(token: string, agents: Record<string, Agent>): Agent | undefined {
  const exact = agents[token];
  if (exact) return exact;
  const lower = token.toLowerCase();
  const bySlug = Object.values(agents).filter((a) => a.slug?.toLowerCase() === lower);
  return bySlug.length === 1 ? bySlug[0] : undefined;
}

/**
 * A line to show where agents were @mentioned by id ("@a1b2c3d4e5f6-security review…"): each mention reads as the
 * agent's name. A leading mention of `addressee` goes, since the row already names who was asked.
 */
export function namedMentions(text: string, agents: Record<string, Agent>, addressee?: string): string {
  const lead = /^\s*@([\p{L}\p{N}_-]+)[\s,:]*/u.exec(text);
  const rest =
    lead && addressee && mentioned(lead[1] ?? "", agents)?.id === addressee ? text.slice(lead[0].length) : text;
  return rest.replace(MENTION, (all, before: string, token: string) => {
    const agent = mentioned(token, agents);
    return agent ? `${before}@${agent.name}` : all;
  });
}

/** "Ramiro → Bruno: " that starts the title of a conversation one agent opened with another. */
export const ASKED = /^[^→\n]*→[^:\n]*:\s*/;

/** A conversation's title to show: its "Ramiro → Bruno: " kept, the request after it with names for mentions. */
export function namedTitle(title: string, agents: Record<string, Agent>, addressee?: string): string {
  const head = ASKED.exec(title)?.[0] ?? "";
  return head + namedMentions(title.slice(head.length), agents, addressee);
}
