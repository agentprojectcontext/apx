import { z } from "zod";
import { ConnectOffer, Id, McpServerStatus } from "./domain.ts";
import { CalendarReminders, IntegrationSettings, MailCheck, McpTarget } from "./resource-methods-schemas.ts";
import { schemaFields } from "./schema-fields.ts";
export const resourceMethodsPart3 = {
  /**
   * The integrations and channels that match words ("figma", "whatsapp"), best first, each connected or not: what an
   * agent offers the owner to connect. Open to agents: names and descriptions only.
   */
  "integrations.find": {
    params: z
      .object(
        schemaFields({
          query: () => z.string().min(1).max(200),
        }),
      )
      .strict(),
    result: z.object(
      schemaFields({
        found: () =>
          z.array(
            ConnectOffer.extend(
              schemaFields({
                connected: () => z.boolean(),
              }),
            ),
          ),
      }),
    ),
    effect: false,
  },
  /** An integration's own settings, beside where it is used: Google Calendar's event reminders. */
  "integrations.settings": {
    params: z
      .object(
        schemaFields({
          id: () => z.string().max(40),
        }),
      )
      .strict(),
    result: IntegrationSettings,
    effect: false,
    access: "human",
  },
  /** Changes an integration's own settings; a field left out keeps its value. */
  "integrations.configure": {
    params: z
      .object(
        schemaFields({
          id: () => z.string().max(40),
          reminders: () => CalendarReminders.partial().strict().optional(),
          mail: () => MailCheck.partial().strict().optional(),
        }),
      )
      .strict(),
    result: IntegrationSettings,
    effect: true,
    access: "human",
  },
  /**
   * Stops (muted) or resumes reminders of one Google Calendar event and every later one of its series. A reminder
   * notice's ref is `event:<series>`.
   */
  "integrations.mute_event": {
    params: z
      .object(
        schemaFields({
          series: () => z.string().min(1).max(1024),
          /** Shown in the muted list; needed when muting. */
          title: () => z.string().max(300).optional(),
          muted: () => z.boolean(),
        }),
      )
      .strict(),
    result: IntegrationSettings,
    effect: true,
    access: "human",
  },
  /** Disconnects one: its server and its secrets go. */
  "integrations.disconnect": {
    params: z
      .object(
        schemaFields({
          id: () => z.string().max(40),
        }),
      )
      .strict(),
    result: z.object(
      schemaFields({
        connected: () => z.literal(false),
      }),
    ),
    effect: true,
    access: "human",
  },
  "mcp.toggle": {
    params: z
      .object(
        schemaFields({
          project: () => Id,
          server: () => z.string().min(1).max(64),
          on: () => z.boolean(),
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
  /**
   * Starts a separate copy of a server and lists its tools: how long it took, or why it failed. The live connection
   * agents use is left alone. A project's server is tested only once the owner approved it (testing runs its command).
   */
  /**
   * The owner signs a server in: it starts now as the connection agents use (its sign-in page opens in their browser)
   * and answers once it is ready, failed, or waits on that page. A server that asked to sign in waits for this.
   */
  "mcp.signIn": {
    params: McpTarget,
    result: z.object(
      schemaFields({
        server: () => McpServerStatus,
      }),
    ),
    effect: true,
    access: "human",
  },
  "mcp.test": {
    params: z
      .object(
        schemaFields({
          scope: () => z.enum(["global", "project"]),
          server: () => z.string().min(1).max(64),
          project: () => Id.optional(),
        }),
      )
      .strict(),
    result: z.object(
      schemaFields({
        ok: () => z.boolean(),
        ms: () => z.number().int(),
        tools: () => z.array(z.string()),
        error: () => z.string().optional(),
      }),
    ),
    effect: false,
    access: "human",
  },
} as const;
