export type AgentDraft = { role: string; prompt: string };

export function applyDraftProposal(
  current: AgentDraft,
  expected: AgentDraft,
  proposed: string,
): AgentDraft | undefined {
  if (current.role !== expected.role || current.prompt !== expected.prompt || current.prompt.trim() || !proposed.trim())
    return undefined;
  return { ...current, prompt: proposed };
}
