import type { Agent, Routine } from "@apx/protocol";

/** Reports research can add to: global routines the super-agent runs, whatever its id. */
export function reportRoutines(routines: readonly Routine[], agents: Readonly<Record<string, Agent>>): Routine[] {
  return routines.filter((r) => !r.project_id && r.action === "agent" && agents[r.agent_id]?.kind === "secretary");
}
