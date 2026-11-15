import { z } from "zod";
import { Id, McpServerStatus } from "./domain.ts";
import { McpTarget } from "./resource-methods-schemas.ts";
import { schemaFields } from "./schema-fields.ts";
export const resourceMethodsPart2 = {
  "mcp.tools": {
    params: McpTarget,
    result: z.object(
      schemaFields({
        tools: () =>
          z.array(
            z.object(
              schemaFields({
                name: () => z.string(),
                key: () => z.string(),
                permanent: () => z.boolean(),
                approved: () => z.boolean(),
              }),
            ),
          ),
        /** all: every tool, those it adds later too; some: the tools approved one by one; ask: none. */
        mode: () => z.enum(["ask", "all", "some"]).optional(),
        /** Why the server did not start, so it has no tools to show. */
        error: () => z.string().optional(),
      }),
    ),
    effect: true,
    access: "human",
  },
  "mcp.describe": {
    params: McpTarget,
    result: z.object(
      schemaFields({
        tools: () =>
          z.array(
            z.object(
              schemaFields({
                name: () => z.string(),
                description: () => z.string().optional(),
                inputSchema: () => z.record(z.string(), z.unknown()),
              }),
            ),
          ),
      }),
    ),
    effect: true,
    access: "human",
  },
  "mcp.call": {
    params: McpTarget.extend(
      schemaFields({
        tool: () => z.string().min(1),
        arguments: () => z.record(z.string(), z.unknown()).default({}),
      }),
    ).strict(),
    result: z.object(
      schemaFields({
        content: () => z.array(z.record(z.string(), z.unknown())).optional(),
        isError: () => z.boolean().optional(),
        structuredContent: () => z.unknown().optional(),
      }),
    ),
    effect: true,
    access: "human",
    replay: false,
  },
  /**
   * Every agent may use all of a server's tools without asking, tools it adds later included ("all"), or none of them
   * ("ask": its grants for every agent go). Picking some is approving tools one by one (mcp.approveTool).
   */
  "mcp.toolMode": {
    params: McpTarget.extend(
      schemaFields({
        mode: () => z.enum(["ask", "all"]),
      }),
    ).strict(),
    result: z.object(
      schemaFields({
        server: () => McpServerStatus,
      }),
    ),
    effect: true,
    access: "human",
  },
  "mcp.approveTool": {
    params: McpTarget.extend(
      schemaFields({
        tool: () => z.string(),
      }),
    ),
    result: z.object(
      schemaFields({
        ok: () => z.literal(true),
      }),
    ),
    effect: true,
    access: "human",
  },
  /**
   * The last lines a stdio server printed on stderr while the core runs (memory only, oldest first; values of its
   * secrets and credential-like variables masked). Empty for a server that has not started since.
   */
  "mcp.logs": {
    params: McpTarget.extend(
      schemaFields({
        lines: () => z.number().int().min(1).max(300).default(100),
      }),
    ).strict(),
    result: z.object(
      schemaFields({
        lines: () =>
          z.array(
            z.object(
              schemaFields({
                at: () => z.string(),
                text: () => z.string(),
              }),
            ),
          ),
      }),
    ),
    effect: false,
    access: "human",
  },
  "mcp.list": {
    params: z
      .object(
        schemaFields({
          project: () => Id.optional(),
        }),
      )
      .strict(),
    result: z.object(
      schemaFields({
        servers: () => z.array(McpServerStatus),
      }),
    ),
    effect: false,
    access: "human",
  },
  /** Approves (or withdraws) a project's server as its file defines it now; a changed file needs approving again. */
  "mcp.trust": {
    params: z
      .object(
        schemaFields({
          project: () => Id.optional(),
          server: () => z.string().min(1).max(64),
          trusted: () => z.boolean(),
        }),
      )
      .strict(),
    result: z.object(
      schemaFields({
        server: () => McpServerStatus,
      }),
    ),
    effect: true,
    access: "human",
  },
  /**
   * Adds, replaces or (null) removes one of the owner's own servers (env and header values may hold secret://), or,
   * with `project`, one in that project's .apc/mcps.json (no secret://; approved as the owner wrote it).
   * `server.project` limits a private server to one project; null makes it global without copying variables.
   */
  "mcp.set": {
    params: z
      .object(
        schemaFields({
          name: () => z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,40}$/),
          project: () => Id.optional(),
          server: () =>
            z
              .object(
                schemaFields({
                  command: () => z.string().optional(),
                  args: () => z.array(z.string()).optional(),
                  env: () => z.record(z.string(), z.string()).optional(),
                  url: () => z.string().url().optional(),
                  headers: () => z.record(z.string(), z.string()).optional(),
                  enabled: () => z.boolean().optional(),
                  /** Where one of the owner's servers lives: a project (it runs only there), or null: global. Never saved in a repo. */
                  project: () => Id.nullable().optional(),
                  /** A global server: the projects it is turned off in; every other project gets it. */
                  off_in: () => z.array(Id).optional(),
                }),
              )
              .strict()
              .refine((s) => !!s.command !== !!s.url, "give either command or url")
              .nullable(),
        }),
      )
      .strict(),
    result: z.object(
      schemaFields({
        servers: () => z.array(McpServerStatus),
      }),
    ),
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
    result: z.object(
      schemaFields({
        integrations: () =>
          z.array(
            z.object(
              schemaFields({
                id: () => z.string(),
                label: () => z.string(),
                description: () => z.string(),
                fields: () =>
                  z.array(
                    z.object(
                      schemaFields({
                        name: () => z.string(),
                        label: () => z.string(),
                        secret: () => z.boolean(),
                        placeholder: () => z.string().optional(),
                        url: () => z.string().optional(),
                        /** A secret field: whether a value is stored (it never comes back). */
                        set: () => z.boolean().optional(),
                        /** A plain field: what was typed, to edit it. */
                        value: () => z.string().optional(),
                      }),
                    ),
                  ),
                connected: () => z.boolean(),
                coming: () => z.boolean(),
                /** Projects where it is turned off (it is on everywhere else). */
                off_in: () => z.array(Id),
                /**
                 * One the owner signs in to (Google): the address their own OAuth client must allow as redirect, the
                 * account it is connected as, whether APX ships a client of its own (no Cloud Console needed) and which
                 * client it is signed in with.
                 */
                /** What its settings hold, beside where it is used: an email signature, the mail check, event reminders. */
                settings: () => z.array(z.enum(["signature", "reminders", "mail"])).optional(),
                oauth: () =>
                  z
                    .object(
                      schemaFields({
                        redirect_uri: () => z.string(),
                        account: () => z.string().optional(),
                        builtin: () => z.boolean().optional(),
                        client: () => z.enum(["apx", "own"]).optional(),
                      }),
                    )
                    .optional(),
              }),
            ),
          ),
      }),
    ),
    effect: false,
    access: "human",
  },
  /**
   * Connects one: its secrets go to the secret store, its server becomes a global one (on in every project). Again on
   * a connected one, it edits it: a field not given keeps its value.
   */
  "integrations.connect": {
    params: z
      .object(
        schemaFields({
          id: () => z.string().max(40),
          values: () => z.record(z.string().max(40), z.string().max(4000)),
        }),
      )
      .strict(),
    result: z.object(
      schemaFields({
        connected: () => z.literal(true),
      }),
    ),
    effect: true,
    access: "human",
  },
  /**
   * Starts signing in to one that uses OAuth (Google) and gives the consent URL to open in a browser. `values.client`
   * picks APX's own client ("apx") or the owner's ("own": the client typed is saved, a field left empty keeps the
   * stored one). Google sends the browser back to the panel's
   * /oauth/google page, which finishes it.
   */
  "integrations.oauth_start": {
    params: z
      .object(
        schemaFields({
          id: () => z.string().max(40),
          values: () => z.record(z.string().max(40), z.string().max(4000)).optional(),
          /** Other Google parts to connect in the same consent (one sign-in for Gmail, Drive and Calendar). */
          also: () => z.array(z.string().max(40)).max(5).optional(),
        }),
      )
      .strict(),
    result: z.object(
      schemaFields({
        url: () => z.string(),
      }),
    ),
    effect: true,
    access: "human",
  },
  /**
   * The code and state Google sent back: a state this core signed minutes ago, used once. Open: Google returns to a
   * browser that may not be paired (the system browser), and the signed state with the core's PKCE verifier is the key.
   */
  "integrations.oauth_finish": {
    params: z
      .object(
        schemaFields({
          code: () => z.string().min(1).max(2000),
          state: () => z.string().min(1).max(2000),
        }),
      )
      .strict(),
    result: z.object(
      schemaFields({
        id: () => z.string(),
        also: () => z.array(z.string()).optional(),
        account: () => z.string().optional(),
      }),
    ),
    effect: true,
    access: "human",
    open: true,
  },
} as const;
