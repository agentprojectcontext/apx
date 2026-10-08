// Methods behind Resources: skills (read, edit, on/off per project), MCP servers (approve, test, on/off per
// project) and variables (stored secrets: names, a hint and where they are used; never the values).
import { z } from "zod";
import { Id, McpServerStatus, ToolApproval } from "./domain.ts";

const McpTarget = z
  .object({ scope: z.enum(["global", "project"]), server: z.string(), project: Id.optional() })
  .strict();

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
   * One variable's value, for the owner's eyes only (the eye in Resources › Variables): never an agent's, never in a
   * prompt or a log.
   */
  "secrets.reveal": {
    params: z.object({ name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/), project: Id.optional() }).strict(),
    result: z.object({ value: z.string() }),
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
  /**
   * Copies APX's skills for other agent apps (Claude Code, Codex, Cursor, ~/.agents) into each one installed, as the
   * core does at every start; `dry_run` only says what it would do. Other skills in those folders are left alone.
   */
  "skills.runtimes": {
    params: z.object({ dry_run: z.boolean().default(false) }).strict(),
    result: z.object({
      steps: z.array(
        z.object({
          runtime: z.string(),
          name: z.string(),
          dir: z.string(),
          action: z.enum(["create", "update", "unchanged", "remove", "skip-link"]),
        }),
      ),
      missing: z.array(z.object({ runtime: z.string(), dir: z.string() })),
    }),
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
  "tools.approvals": {
    params: z.object({ thread: Id.optional() }).strict(),
    result: z.object({ approvals: z.array(ToolApproval) }),
    effect: false,
    access: "human",
  },
  "tools.revoke": {
    params: z.object({ key: z.string().min(1), thread: Id.optional(), agent: Id.optional() }).strict(),
    result: z.object({ ok: z.literal(true) }),
    effect: true,
    access: "human",
  },
  "mcp.tools": {
    params: McpTarget,
    result: z.object({
      tools: z.array(z.object({ name: z.string(), key: z.string(), permanent: z.boolean(), approved: z.boolean() })),
      /** Why the server did not start, so it has no tools to show. */
      error: z.string().optional(),
    }),
    effect: true,
    access: "human",
  },
  "mcp.describe": {
    params: McpTarget,
    result: z.object({
      tools: z.array(
        z.object({
          name: z.string(),
          description: z.string().optional(),
          inputSchema: z.record(z.string(), z.unknown()),
        }),
      ),
    }),
    effect: true,
    access: "human",
  },
  "mcp.call": {
    params: McpTarget.extend({
      tool: z.string().min(1),
      arguments: z.record(z.string(), z.unknown()).default({}),
    }).strict(),
    result: z.object({
      content: z.array(z.record(z.string(), z.unknown())).optional(),
      isError: z.boolean().optional(),
      structuredContent: z.unknown().optional(),
    }),
    effect: true,
    access: "human",
    replay: false,
  },
  "mcp.approveTool": {
    params: McpTarget.extend({ tool: z.string() }),
    result: z.object({ ok: z.literal(true) }),
    effect: true,
    access: "human",
  },
  "mcp.list": {
    params: z.object({ project: Id.optional() }).strict(),
    result: z.object({ servers: z.array(McpServerStatus) }),
    effect: false,
    access: "human",
  },
  /** Approves (or withdraws) a project's server as its file defines it now; a changed file needs approving again. */
  "mcp.trust": {
    params: z.object({ project: Id.optional(), server: z.string().min(1).max(64), trusted: z.boolean() }).strict(),
    result: z.object({ server: McpServerStatus }),
    effect: true,
    access: "human",
  },
  /**
   * Adds, replaces or (null) removes one of the owner's own servers (env and header values may hold secret://), or,
   * with `project`, one in that project's .apc/mcps.json (no secret://; approved as the owner wrote it).
   */
  "mcp.set": {
    params: z
      .object({
        name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,40}$/),
        project: Id.optional(),
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
  /**
   * Accounts the owner can connect (GitHub, Notion, Slack…), each with its MCP server and variables: connected or not,
   * the projects it is off in, and the ones still coming.
   */
  "integrations.list": {
    params: z.object({}).strict(),
    result: z.object({
      integrations: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          description: z.string(),
          fields: z.array(
            z.object({
              name: z.string(),
              label: z.string(),
              secret: z.boolean(),
              placeholder: z.string().optional(),
              url: z.string().optional(),
              /** A secret field: whether a value is stored (it never comes back). */
              set: z.boolean().optional(),
              /** A plain field: what was typed, to edit it. */
              value: z.string().optional(),
            }),
          ),
          connected: z.boolean(),
          coming: z.boolean(),
          /** Projects where it is turned off (it is on everywhere else). */
          off_in: z.array(Id),
          /**
           * One the owner signs in to (Google): the address their OAuth client must allow as redirect, and the
           * account it is connected as.
           */
          oauth: z.object({ redirect_uri: z.string(), account: z.string().optional() }).optional(),
        }),
      ),
    }),
    effect: false,
    access: "human",
  },
  /**
   * Connects one: its secrets go to the secret store, its server becomes a global one (on in every project). Again on
   * a connected one, it edits it: a field not given keeps its value.
   */
  "integrations.connect": {
    params: z.object({ id: z.string().max(40), values: z.record(z.string().max(40), z.string().max(4000)) }).strict(),
    result: z.object({ connected: z.literal(true) }),
    effect: true,
    access: "human",
  },
  /**
   * Starts signing in to one that uses OAuth (Google): saves the OAuth client typed (a field left empty keeps the
   * stored one) and gives the consent URL to open in a browser. Google sends the browser back to the panel's
   * /oauth/google page, which finishes it.
   */
  "integrations.oauth_start": {
    params: z
      .object({
        id: z.string().max(40),
        values: z.record(z.string().max(40), z.string().max(4000)).optional(),
      })
      .strict(),
    result: z.object({ url: z.string() }),
    effect: true,
    access: "human",
  },
  /** The code and state Google sent back: a state this core signed minutes ago, used once. */
  "integrations.oauth_finish": {
    params: z.object({ code: z.string().min(1).max(2000), state: z.string().min(1).max(2000) }).strict(),
    result: z.object({ id: z.string(), account: z.string().optional() }),
    effect: true,
    access: "human",
  },
  /** Disconnects one: its server and its secrets go. */
  "integrations.disconnect": {
    params: z.object({ id: z.string().max(40) }).strict(),
    result: z.object({ connected: z.literal(false) }),
    effect: true,
    access: "human",
  },
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
