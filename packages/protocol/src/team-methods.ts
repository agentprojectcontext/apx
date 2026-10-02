// Methods behind the Team screen: agent templates (APX's own and the v1 vault's, read-only) and installing them.
import { z } from "zod";
import { Agent, Id } from "./domain.ts";

/** Where a template comes from: shipped with APX, or the owner's v1 vault (read, never written). */
export const TemplateSource = z.enum(["apx", "v1"]);
export type TemplateSource = z.infer<typeof TemplateSource>;

export const AgentTemplate = z.object({
  /** Opaque id to install it with (source, team and slug). */
  id: z.string(),
  source: TemplateSource,
  slug: z.string(),
  name: z.string(),
  role: z.string(),
  description: z.string().optional(),
  /** Slug of the member it reports to inside its team. */
  parent: z.string().optional(),
  area: z.string().optional(),
  /** The team's top: no parent inside the team. */
  lead: z.boolean(),
});
export type AgentTemplate = z.infer<typeof AgentTemplate>;

export const TeamTemplate = z.object({
  id: z.string(),
  source: TemplateSource,
  name: z.string(),
  description: z.string().optional(),
  members: z.array(AgentTemplate),
});
export type TeamTemplate = z.infer<typeof TeamTemplate>;

export const teamMethods = {
  /** Teams and single agents that can be added to a project. Every team member is also offered on its own. */
  "agents.templates": {
    params: z.object({}).strict(),
    result: z.object({ teams: z.array(TeamTemplate), singles: z.array(AgentTemplate) }),
    effect: false,
    access: "human",
  },
  /**
   * Writes the chosen templates as .apc/agents/<slug>.md in the project. A slug the project already has is skipped,
   * never overwritten. `hang_under` (a slug in the project) becomes the parent of every installed agent that has none
   * inside what is installed, so a team brought into a project with an orchestrator does not start a second tree.
   */
  "agents.install": {
    params: z
      .object({
        project_id: Id,
        templates: z.array(z.string()).min(1).max(50),
        hang_under: z.string().max(64).optional(),
      })
      .strict(),
    result: z.object({
      installed: z.array(Agent),
      skipped: z.array(z.object({ template: z.string(), reason: z.string() })),
    }),
    effect: true,
    access: "human",
  },
} as const;
