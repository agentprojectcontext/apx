import { z } from "zod";
import { AgentRules, Autonomy, Id } from "./domain-projects.ts";

/** Who runs a turn's loop. `acp` covers every Agent Client Protocol CLI; the engine id says which ("acp:opencode"). */
export const HarnessId = z.enum(["native", "claude", "codex", "acp", "aider", "antigravity"]);
export type HarnessId = z.infer<typeof HarnessId>;

/**
 * A model, named by the engine that runs it: "claude/claude-opus-5-5", "codex/gpt-6-sol", "gemini/gemini-3.8-flash".
 * An engine alone ("claude", "codex") means that engine's own default model.
 */
export const ModelRef = z
  .string()
  // An ACP agent's engine id carries its prefix: "acp:opencode/<model>"; "#high" asks for that reasoning effort.
  .regex(/^(acp:)?[a-z0-9][a-z0-9._-]*(\/[^#]+)?(#[a-z0-9-]+)?$/i)
  .max(200);
export type ModelRef = z.infer<typeof ModelRef>;

/** How many models of its own an agent may fall back on after its main one. */
export const MAX_MODEL_FALLBACKS = 5;

/**
 * How an agent picks its model for a turn: a fixed model; a model with the router as fallback; or the router alone
 * (`model` absent). `fallbacks` are tried in order after `model` and before the router (DECISIONS.md#d-195). An agent
 * without a choice uses the install default.
 */
export const ModelChoice = z.object({
  model: ModelRef.optional(),
  router: z.boolean(),
  fallbacks: z.array(ModelRef).max(MAX_MODEL_FALLBACKS).optional(),
});
export type ModelChoice = z.infer<typeof ModelChoice>;

/** The model router: per-turn rules (first match wins) and the fallback chain after them. */
export const RouterRule = z.object({
  /** Every condition present must hold; an empty `when` matches every turn. */
  when: z.object({
    has_image: z.boolean().optional(),
    min_chars: z.number().int().nonnegative().optional(),
    max_chars: z.number().int().nonnegative().optional(),
    min_context_chars: z.number().int().nonnegative().optional(),
    channels: z.array(z.string()).optional(),
    triggers: z.array(z.string()).optional(),
    agent_kinds: z.array(z.enum(["secretary", "agent"])).optional(),
    keywords: z.array(z.string().min(2)).optional(),
  }),
  model: ModelRef,
  note: z.string().max(200).optional(),
});
export type RouterRule = z.infer<typeof RouterRule>;
export const RouterConfig = z.object({ rules: z.array(RouterRule), chain: z.array(ModelRef) });
export type RouterConfig = z.infer<typeof RouterConfig>;

/** What an engine can run, asked to the engine itself. */
export const CatalogEngine = z.object({
  /** "claude", "codex", or a provider id ("gemini", "anthropic", …). */
  id: z.string(),
  kind: z.enum(["harness", "provider"]),
  label: z.string(),
  available: z.boolean(),
  detail: z.string().optional(),
  models: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().optional(),
      chat: z.boolean(),
      /** The reasoning efforts it takes ("low", "high"…), and the one it uses when none is asked for. */
      efforts: z.array(z.string()).optional(),
      default_effort: z.string().optional(),
    }),
  ),
  fetched_at: z.string().optional(),
  /** A model API's everyday chat model: what the router chain gets when the owner adds this provider. */
  starter: z.string().optional(),
  /** A model app on this computer (Ollama, LM Studio), found with no setup or set up at its address: free. */
  local: z.boolean().optional(),
});
export type CatalogEngine = z.infer<typeof CatalogEngine>;

export const Agent = z.object({
  id: Id,
  name: z.string(),
  role: z.string().default(""),
  kind: z.enum(["secretary", "agent"]),
  blob: z.string().optional(),
  project_id: Id.optional(),
  /** Browser profile this agent may use: shared jar, an isolated jar, or always incognito. */
  browser_profile: z.enum(["shared", "isolated", "incognito"]).default("shared"),
  /** Absent = the install default. */
  model_choice: ModelChoice.optional(),
  /** The file name in .apc/agents/ for project agents. */
  slug: z.string().optional(),
  /** The agent it reports to, inside the same project: its slug (or its full id). */
  parent: z.string().optional(),
  /** Group it belongs to in the team view ("product", "sports"). From `area:`. */
  area: z.string().optional(),
  description: z.string().optional(),
  /** "apc" = defined by a file in the project; "local" = defined in APX itself. */
  source: z.enum(["apc", "local"]).default("local"),
  /** The engine of the agent's own model, when it has one (derived from `model_choice`). */
  harness: HarnessId.optional(),
  /** Tools (or groups: browser, widgets, agents, shell) it may use; absent = the default set. From `tools:`. */
  tools: z.array(z.string()).optional(),
  /** How often it stops for the owner's yes. From `autonomy:`; absent = its project's (DECISIONS.md#d-072). */
  autonomy: Autonomy.optional(),
  /** Skills it works with (its catalog is narrowed to these). From `skills:`; absent = every skill it can see. */
  skills: z.array(z.string()).optional(),
  /** How it comes across (warm, dry, playful…), apart from its instructions. */
  personality: z.string().max(1000).optional(),
  /**
   * It runs its team: on top of the chart, and the one work goes to first. From `orchestrator:`; false says it is not,
   * whatever its role suggests; absent, the head is guessed by role.
   */
  orchestrator: z.boolean().optional(),
  /** Its own rules by risk, over its autonomy. From `rules:`. */
  rules: AgentRules.optional(),
});
export type Agent = z.infer<typeof Agent>;

/** Resolved directory metadata; the stored orchestrator flag above remains unchanged. */
export const AgentListing = Agent.extend({
  scope: z.enum(["global", "project"]),
  project_name: z.string().nullable(),
  project_orchestrator: z
    .object({
      id: Id,
      name: z.string(),
      selection: z.enum(["marked", "role", "sole_head"]),
    })
    .nullable(),
  /** Heads the whole project; a marked agent with a parent leads only its reports. */
  is_orchestrator: z.boolean(),
  /** The agent its `parent:` names, resolved by slug or full id; null at the top of its team. */
  reports_to: z.object({ id: Id, name: z.string() }).nullable(),
  /** Ids of the agents that report to it. */
  leads: z.array(Id),
  /**
   * Only in a project's listing (agents.list `project_id`): set on an agent the project takes from its parent, the
   * parent's id (BASE_PROJECT_ID for the base project's agents). Absent on the project's own agents.
   */
  inherited_from: Id.optional(),
});
export type AgentListing = z.infer<typeof AgentListing>;

/** What the setup and Config → Motores show: installed → logged in → usable. */
export const EngineStatus = z.object({
  /** "native", "claude", "codex" or an ACP agent ("acp:opencode"). */
  id: z.string(),
  label: z.string(),
  installed: z.boolean(),
  logged_in: z.boolean(),
  /** Authentication cannot be probed separately for one-shot CLIs. */
  auth: z.literal("on_invocation").optional(),
  detail_code: z.enum(["oneshot", "oneshot_missing", "oneshot_windows_shim"]).optional(),
  version: z.string().optional(),
  /** Model or account detail, never a secret. */
  detail: z.string().optional(),
  default: z.boolean(),
});
export type EngineStatus = z.infer<typeof EngineStatus>;
