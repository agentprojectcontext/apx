// Methods behind the Team screen: agent templates (APX's own and the v1 vault's, read-only) and installing them.
import { z } from "zod";
import { Agent, Id, Organization, ProjectKind } from "./domain.ts";
import { Routine, RoutineAction, Schedule } from "./office.ts";

/** Where a template comes from: shipped with APX, or the owner's v1 vault (read, never written). */
export const TemplateSource = z.enum(["apx", "v1"]);
export type TemplateSource = z.infer<typeof TemplateSource>;

/**
 * A routine an agent template comes with, from `<slug>.routines.json` beside its file: installing the agent in a
 * project adds it there, on, so an executive team runs its own rituals without any project profile.
 */
export const TemplateRoutine = z.object({
  name: z.string().trim().min(1).max(80),
  schedule: Schedule,
  action: RoutineAction.extract(["agent", "watch"]).default("agent"),
  prompt: z.string().min(1).max(8000),
});
export type TemplateRoutine = z.infer<typeof TemplateRoutine>;

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
  /** What it does on its own once installed: each routine's name and when it runs. */
  routines: z.array(TemplateRoutine.pick({ name: true, schedule: true })).default([]),
});
export type AgentTemplate = z.infer<typeof AgentTemplate>;

export const TeamTemplate = z.object({
  id: z.string(),
  source: TemplateSource,
  name: z.string(),
  description: z.string().optional(),
  /** The kind of project it makes (TEAM.md's `kind:`): installing its members turns the project into one. */
  kind: ProjectKind.optional(),
  members: z.array(AgentTemplate),
});
export type TeamTemplate = z.infer<typeof TeamTemplate>;

/**
 * How far agents may go on their own (delegating, waking each other with results) in one conversation before they
 * wait for the owner, counted since the owner last wrote there. 0 = no limit.
 */
export const AgentLimits = z.object({
  runs: z.number().int().min(0).max(10_000),
  tokens: z.number().int().min(0).max(1_000_000_000),
});
export type AgentLimits = z.infer<typeof AgentLimits>;

/**
 * One agent's own share of that, inside the conversation's: past it that agent waits while others may go on. A field
 * unset or 0 adds no limit of its own.
 */
export const AgentBudget = AgentLimits.partial();
export type AgentBudget = z.infer<typeof AgentBudget>;
/** Each agent's own budget, by agent id: only the agents the owner gave one. */
export const AgentBudgets = z.record(z.string(), AgentBudget);

export const teamMethods = {
  /** Teams and single agents that can be added to a project. Every team member is also offered on its own. */
  "agents.templates": {
    params: z.object({}).strict(),
    result: z.object({ teams: z.array(TeamTemplate), singles: z.array(AgentTemplate) }),
    effect: false,
    access: "human",
  },
  /**
   * Writes the chosen templates as .apc/agents/<slug>.md in the project (no project: global agents of the base
   * project). A slug the project already has is skipped, never overwritten. `hang_under` (a slug in the project)
   * becomes the parent of every installed agent that has none inside what is installed, so a team brought into a
   * project with an orchestrator does not start a second tree. Members of a team with a kind (the executive team is
   * a company) make the project that kind and add their areas and roles to it: one import sets the company up.
   */
  "agents.install": {
    params: z
      .object({
        project_id: Id.optional(),
        templates: z.array(z.string()).min(1).max(50),
        hang_under: z.string().max(64).optional(),
      })
      .strict(),
    result: z.object({
      installed: z.array(Agent),
      /** The routines the installed agents came with, added to the project and on. */
      routines: z.array(Routine).default([]),
      /** The kind the project took from the team, and its areas and roles after the install. */
      project_kind: ProjectKind.optional(),
      organization: Organization.optional(),
      skipped: z.array(z.object({ template: z.string(), reason: z.string() })),
    }),
    effect: true,
    access: "human",
  },
  /**
   * Copies agents into a project (none: among the global ones) with their whole definition; reports stay under their
   * cloned boss, the rest hang under `hang_under`. An agent is one project's, so each copy is a new agent: `rename`
   * gives it a name nobody on the install uses. The super-agent is never copied. Routines and memory stay behind.
   */
  "agents.clone": {
    params: z
      .object({
        agents: z.array(Id).min(1).max(50),
        project_id: Id.optional(),
        rename: z.boolean().default(false),
        hang_under: z.string().max(64).optional(),
      })
      .strict(),
    result: z.object({
      cloned: z.array(Agent),
      skipped: z.array(z.object({ agent: z.string(), reason: z.string() })),
    }),
    effect: true,
    access: "human",
  },
  "agents.limits": {
    params: z.object({}).strict(),
    result: AgentLimits.extend({ defaults: AgentLimits, agents: AgentBudgets, fan_out_ask: z.boolean() }),
    effect: false,
    access: "human",
  },
  "agents.set_limits": {
    params: AgentLimits.strict(),
    result: AgentLimits,
    effect: true,
    access: "human",
  },
  /** Whether the super-agent asks before handing work to several agents in one turn. */
  "agents.set_fan_out_ask": {
    params: z.object({ ask: z.boolean() }).strict(),
    result: z.object({ ask: z.boolean() }),
    effect: true,
    access: "human",
  },
  /** Gives one agent a budget of its own (null takes it away); returns every agent's. */
  "agents.set_agent_limits": {
    params: z.object({ agent: z.string().min(1), limits: AgentBudget.strict().nullable() }).strict(),
    result: z.object({ agents: AgentBudgets }),
    effect: true,
    access: "human",
  },
} as const;
