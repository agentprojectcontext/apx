// Which background jobs a chat should show as "agents working for you".
//
// Scoped by PROJECT, Roby's chat showed nothing while three agents worked for
// it: its chat lives in `default`, and a job lives in the project of the agent
// it reached. Scoped by AGENT, it shows what that agent handed out and — one
// hop further down — what those agents handed on, so a chain (Roby → lead →
// editor) reads as one piece of work instead of vanishing after the first link.

/** The super-agent's actor id on job records (core/constants/actors.js). */
export const SUPER_AGENT_ACTOR = "super_agent";

interface JobLike {
  id: string;
  from?: string | null;
  to?: string | null;
  project_id?: string | number | null;
}

export interface ScopedJob<J extends JobLike> {
  job: J;
  /** 0 = handed out by this chat's agent, 1 = handed on by one of those, … */
  depth: number;
}

export function jobsForScope<J extends JobLike>(
  jobs: J[],
  { projectId, agentSlug, maxDepth = 2 }: { projectId?: string | number | null; agentSlug?: string | null; maxDepth?: number },
): ScopedJob<J>[] {
  if (!agentSlug) {
    return jobs
      .filter((j) => projectId == null || String(j.project_id) === String(projectId))
      .map((job) => ({ job, depth: 0 }));
  }
  const out: ScopedJob<J>[] = [];
  const seen = new Set<string>();
  let frontier = new Set([agentSlug]);
  for (let depth = 0; depth <= maxDepth && frontier.size; depth++) {
    const next = new Set<string>();
    for (const job of jobs) {
      if (seen.has(job.id) || !job.from || !frontier.has(job.from)) continue;
      seen.add(job.id);
      out.push({ job, depth });
      if (job.to) next.add(job.to);
    }
    frontier = next;
  }
  return out;
}
