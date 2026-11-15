import { z } from "zod";

export const Id = z.string().min(1).max(128);

/** What a project is, as the owner picks it in its settings. A project's file may still name another kind. */
export const ProjectKind = z.enum(["personal", "app", "company", "software", "other"]);

/**
 * An agent's permission mode, in the order the owner picks from (DECISIONS.md#d-106). `manual`: every call that changes
 * something waits for the owner. `auto` (the default): reads anywhere but APX's home, writes and runs commands in the
 * folder it works in and its temp folder, and asks only for strong actions. `accept_edits`: as auto, but a command that
 * changes something asks. `plan`: reads and proposes, changes nothing. `total`: nothing waits (DECISIONS.md#d-047).
 */
export const Autonomy = z.enum(["manual", "auto", "accept_edits", "plan", "total"]);
export type Autonomy = z.infer<typeof Autonomy>;
/** The mode of an agent and a project that set none. */
export const DEFAULT_AUTONOMY: Autonomy = "auto";

/**
 * What a tool call does, by risk: reads; changes the project (files, memory, delegating); acts outside in the owner's
 * name (messages, posts, clicks on the web); or cannot be undone (deleting, granting). DECISIONS.md#d-090
 */
export const ToolRisk = z.enum(["read", "write", "outside", "irreversible"]);
export type ToolRisk = z.infer<typeof ToolRisk>;
/** An agent's own rule for one risk: runs without asking, asks first, or is never used. */
export const RulePolicy = z.enum(["auto", "ask", "off"]);
export type RulePolicy = z.infer<typeof RulePolicy>;
/** Its rules by risk; a risk left out follows its autonomy. */
export const AgentRules = z.object({
  read: RulePolicy.optional(),
  write: RulePolicy.optional(),
  outside: RulePolicy.optional(),
  irreversible: RulePolicy.optional(),
});
export type AgentRules = z.infer<typeof AgentRules>;

/**
 * What each autonomy amounts to per risk, only as the editor shows it: the core runs the mode itself, so this is never
 * saved as an agent's rules (DECISIONS.md#d-090).
 */
export const AUTONOMY_RULES: Record<Autonomy, Required<AgentRules>> = {
  manual: { read: "auto", write: "ask", outside: "ask", irreversible: "ask" },
  auto: { read: "auto", write: "auto", outside: "ask", irreversible: "ask" },
  accept_edits: { read: "auto", write: "auto", outside: "ask", irreversible: "ask" },
  plan: { read: "auto", write: "off", outside: "off", irreversible: "off" },
  total: { read: "auto", write: "auto", outside: "auto", irreversible: "auto" },
};

/**
 * How a subproject names the base project as its parent (the base has no id of its own elsewhere: it is the absence of
 * a project). Never a real project's id, which always starts with `p_`.
 */
export const BASE_PROJECT_ID = "~default";

/** The base project (no folder): the owner may name it, describe it and give it a kind, like any other. */
export const BaseProject = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).optional(),
  kind: ProjectKind.optional(),
  /** How far its agents go on their own when they set nothing themselves. Absent = auto. */
  autonomy: Autonomy.optional(),
});
export type BaseProject = z.infer<typeof BaseProject>;

const OrgSlug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/)
  .max(40);
/** An area of a company project ("Finance"): agents and roles belong to one. */
export const OrgArea = z.object({
  slug: OrgSlug,
  name: z.string().trim().min(1).max(60),
  goal: z.string().max(300).optional(),
});
/** A role the company has ("Chief Financial Officer"), in an area or general. An agent takes one. */
export const OrgRole = z.object({
  slug: OrgSlug,
  name: z.string().trim().min(1).max(80),
  area: OrgSlug.optional(),
  description: z.string().max(500).optional(),
});
/** A project's areas and roles: `.apc/organization.json` (v1's format), the base project's in APX's settings. */
export const Organization = z.object({ areas: z.array(OrgArea).max(40), roles: z.array(OrgRole).max(200) });
export type Organization = z.infer<typeof Organization>;
export type ProjectKind = z.infer<typeof ProjectKind>;

/**
 * A safety limit, not a budget: a project's AGENTS.md (and .apc/memory.md) reach its agents whole up to this many
 * UTF-16 code units. Past it, the head and tail are sent with a marker naming the lines left out.
 * The owner-facing CLI/UI notice covers AGENTS.md only; token usage depends on the content and model.
 */
export const AGENTS_MD_LIMIT = 200_000;

export const Project = z.object({
  /** False only in the optional history catalog after the owner unregisters a folder. */
  registered: z.boolean().optional(),
  id: Id,
  name: z.string(),
  description: z.string().optional(),
  /** "company", "software", "personal"… as the project's .apc/project.json says. */
  kind: z.string().optional(),
  /** false when the registered folder is not on disk (moved, unmounted drive). */
  present: z.boolean().default(true),
  /**
   * Why a folder that is there could not be read: `waiting`, the system has not let APX in yet (a macOS privacy
   * prompt nobody answered); `denied`, it refused. Known only to the running core.
   */
  unreadable: z.enum(["waiting", "denied"]).optional(),
  /** Blob name from the design system catalog, used as the project's avatar. */
  blob: z.string().optional(),
  path: z.string().optional(),
  /** How far its agents go on their own when they set nothing themselves; kept by APX, never in the folder. */
  autonomy: Autonomy.optional(),
  /** Absolute folders its agents may read and never change (another checkout, docs); kept by APX. */
  read_only_folders: z.array(z.string()).optional(),
  /** AGENTS.md's length when it is past AGENTS_MD_LIMIT: its agents get the head and tail, not all of it. */
  agents_md_chars: z.number().int().optional(),
  /**
   * Set on a subproject: the project it belongs to, or BASE_PROJECT_ID for the base project. One level only (a
   * subproject has none of its own). Its parent's agents work in it, and it takes its parent's variables, skills, MCP
   * servers and apps under its own; its memory is its own. Kept by APX, never in the folder.
   */
  parent: Id.optional(),
});
export type Project = z.infer<typeof Project>;
