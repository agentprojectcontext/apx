import type { Agent } from "@apx/protocol";

export type Mention = { start: number; end: number; query: string };

/** Only the mention at the caret opens the picker; email addresses do not. */
export function mentionAt(text: string, caret: number): Mention | undefined {
  const match = /(?:^|[^\p{L}\p{N}_@])@([\p{L}\p{N}_-]*)$/u.exec(text.slice(0, caret));
  if (!match) return undefined;
  const query = match[1] ?? "";
  return { start: caret - query.length - 1, end: caret, query };
}

/** Use the readable slug when it is unambiguous in the core's lookup scope. */
export function mentionToken(agent: Agent, agents: readonly Agent[], projectId?: string): string {
  const ref = agent.slug ?? agent.id;
  const matches = agents.filter(
    (a) =>
      (!a.project_id || a.project_id === projectId) &&
      (a.id === ref || a.slug?.toLowerCase() === ref.toLowerCase() || a.name.toLowerCase() === ref.toLowerCase()),
  );
  return matches.length === 1 && matches[0]?.id === agent.id ? ref : agent.id;
}

export function insertMention(text: string, mention: Mention, token: string): { text: string; caret: number } {
  const prefix = `${text.slice(0, mention.start)}@${token} `;
  return { text: prefix + text.slice(mention.end), caret: prefix.length };
}
