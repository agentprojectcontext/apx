// Methods behind Resources: skills (read, edit, on/off per project), MCP servers (approve, test, on/off per
// project) and variables (stored secrets: names, a hint and where they are used; never the values).
import { z } from "zod";
import { Id, McpServerStatus } from "./domain.ts";

const SkillName = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/);

export const SkillInfo = z.object({
  name: z.string(),
  description: z.string(),
  scope: z.enum(["global", "project"]),
  project_id: Id.optional(),
  /** owner: APX home `skills/`; claude: linked there from Claude's skills; project: `.apc/skills/`; extension. */
  source: z.enum(["owner", "claude", "project", "extension"]),
  /** On where it was asked about (the project, or everywhere). */
  on: z.boolean(),
  /** Projects where the owner turned this global skill off. */
  off_in: z.array(Id).default([]),
  /** Turned off everywhere: a project cannot turn it back on for itself. */
  off_everywhere: z.boolean().default(false),
  editable: z.boolean(),
  /** Where its SKILL.md lives, home shortened to ~. */
  path: z.string(),
});
export type SkillInfo = z.infer<typeof SkillInfo>;

export const SecretInfo = z.object({
  name: z.string(),
  /** A project's own value: it wins over the global one of the same name for that project's MCP servers. */
  project_id: Id.optional(),
  updated_at: z.string(),
  /** The last four characters, kept only for values long enough that they give nothing away ("••••1a2b"). */
  hint: z.string().optional(),
  /** Where it is named: "mcp:github", "provider:openai", "service:qvox", "channel:telegram". */
  used_in: z.array(z.string()).default([]),
});
export type SecretInfo = z.infer<typeof SecretInfo>;

export const resourceMethods = {
  /** Names of the stored secrets with a hint and where each is used; values never leave the core. */
  "secrets.list": {
    params: z.object({}).strict(),
    result: z.object({ secrets: z.array(SecretInfo) }),
    effect: false,
    access: "human",
  },
  /**
   * Skills agents can load: the owner's (APX home `skills/`), a project's `.apc/skills/` with `project`, and enabled
   * extensions'. Skills the owner turned off are listed with `on: false`; agents do not see them.
   */
  "skills.list": {
    params: z.object({ project: Id.optional() }).strict(),
    result: z.object({ skills: z.array(SkillInfo) }),
    effect: false,
  },
  "skills.get": {
    params: z.object({ name: SkillName, project: Id.optional() }).strict(),
    result: z.object({ skill: SkillInfo, content: z.string(), files: z.array(z.string()) }),
    effect: false,
    access: "human",
  },
  /**
   * Writes a skill's SKILL.md: the owner's (`global`) or the project's (`project`). Saving a global skill as `project`
   * makes the project's own copy, which takes its place there and leaves the original untouched.
   */
  "skills.save": {
    params: z
      .object({
        name: SkillName,
        target: z.enum(["global", "project"]),
        project: Id.optional(),
        content: z.string().min(1).max(200_000),
      })
      .strict(),
    result: z.object({ skill: SkillInfo }),
    effect: true,
    access: "human",
  },
  /** Turns a skill off (or back on) everywhere, or only inside one project. */
  "skills.toggle": {
    params: z.object({ name: SkillName, project: Id.optional(), on: z.boolean() }).strict(),
    result: z.object({ ok: z.literal(true) }),
    effect: true,
    access: "human",
  },
  /** Whether a project takes the owner's global skills and MCP servers (each can still be turned off one by one). */
  "resources.inheritance": {
    params: z.object({ project: Id }).strict(),
    result: z.object({ skills: z.boolean(), mcp: z.boolean() }),
    effect: false,
    access: "human",
  },
  /** A project takes the owner's global skills (or MCP servers), or none of them: only its own count there. */
  "resources.inherit": {
    params: z.object({ project: Id, kind: z.enum(["skills", "mcp"]), on: z.boolean() }).strict(),
    result: z.object({ skills: z.boolean(), mcp: z.boolean() }),
    effect: true,
    access: "human",
  },
  /** MCP servers: the owner's and each project's, with whether they are approved, running and on here. */
  "mcp.list": {
    params: z.object({ project: Id.optional() }).strict(),
    result: z.object({ servers: z.array(McpServerStatus) }),
    effect: false,
    access: "human",
  },
  /** Approves (or withdraws) a project's server as its file defines it now; a changed file needs approving again. */
  "mcp.trust": {
    params: z.object({ project: Id, server: z.string().min(1).max(64), trusted: z.boolean() }).strict(),
    result: z.object({ server: McpServerStatus }),
    effect: true,
    access: "human",
  },
  /** Adds, replaces or (null) removes one of the owner's own servers. Env and header values may be secret://. */
  "mcp.set": {
    params: z
      .object({
        name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,40}$/),
        server: z
          .object({
            command: z.string().optional(),
            args: z.array(z.string()).optional(),
            env: z.record(z.string(), z.string()).optional(),
            url: z.string().url().optional(),
            headers: z.record(z.string(), z.string()).optional(),
            enabled: z.boolean().optional(),
          })
          .strict()
          .refine((s) => !!s.command !== !!s.url, "give either command or url")
          .nullable(),
      })
      .strict(),
    result: z.object({ servers: z.array(McpServerStatus) }),
    effect: true,
    access: "human",
  },
  /** Turns one of the owner's global servers off (or back on) inside a project; elsewhere it stays as it is. */
  "mcp.toggle": {
    params: z.object({ project: Id, server: z.string().min(1).max(64), on: z.boolean() }).strict(),
    result: z.object({ servers: z.array(McpServerStatus) }),
    effect: true,
    access: "human",
  },
  /**
   * Starts a separate copy of a server and lists its tools: how long it took, or why it failed. The live connection
   * agents use is left alone. A project's server is tested only once the owner approved it (testing runs its command).
   */
  "mcp.test": {
    params: z
      .object({ scope: z.enum(["global", "project"]), server: z.string().min(1).max(64), project: Id.optional() })
      .strict(),
    result: z.object({
      ok: z.boolean(),
      ms: z.number().int(),
      tools: z.array(z.string()),
      error: z.string().optional(),
    }),
    effect: false,
    access: "human",
  },
} as const;
