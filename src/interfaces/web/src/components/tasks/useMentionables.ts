import useSWR from "swr";
import { Agents } from "../../lib/api/agents";
import { SUPER_AGENT_ICON } from "../agents/AgentAvatar";
import { useSuperAgentConfig } from "../../hooks/useGlobalConfig";
import { usePersonaName } from "../../hooks/usePersonaName";
import type { AgentFace } from "../../types/daemon";

/** The slug storage signs the super-agent's own comments with. */
export const SUPER_AGENT_SLUG = "super_agent";

/**
 * Everyone a task comment can summon, with the face to draw them by.
 *
 * The project's own agents PLUS the super-agent. It is the one that knows every
 * project, and it is the obvious thing to tag from a phone — you are not at the
 * desk, which is the entire reason you are handing the task to somebody. It
 * used to be the single participant you could not reach (core/tasks/
 * comment-turn.js resolved mentions against the project roster alone).
 *
 * Only when it is configured: an @mention that resolves to an agent with no
 * model gets an error for an answer, which is worse than not offering it.
 */
export function useMentionables(pid: string): AgentFace[] {
  const { data: agents } = useSWR(pid ? `/api/projects/${pid}/agents` : null, () => Agents.list(pid));
  const { superAgent } = useSuperAgentConfig();
  const persona = usePersonaName();

  const project = (agents ?? []).map((a) => ({
    slug: a.slug,
    icon: a.icon,
    emoji: a.emoji,
    name: a.name || a.slug,
  }));
  if (!superAgent?.enabled || !superAgent?.model) return project;
  return [
    { slug: SUPER_AGENT_SLUG, icon: superAgent.icon || SUPER_AGENT_ICON, name: persona },
    ...project,
  ];
}
