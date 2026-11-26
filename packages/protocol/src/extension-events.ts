import { z } from "zod";
import { deferMethod } from "./defer-method.ts";
import { schemaFields } from "./schema-fields.ts";

const Name = z.string().regex(/^[a-z0-9][a-z0-9_]{0,39}$/);
export const ExtensionEventDeclaration = z
  .object(
    schemaFields({
      name: () => Name,
      description: () => z.string().trim().min(1).max(300),
    }),
  )
  .strict();

/** The core calls only this tool, in the extension's own approved MCP server. */
export const ExtensionMonitor = z
  .object(
    schemaFields({
      server: () => z.string().regex(/^[a-z0-9][a-z0-9_]{0,19}$/),
      tool: () => z.string().min(1).max(80),
      every_seconds: () => z.number().int().min(30).max(3600),
      /** Allows cursor bookkeeping, never appliance controls. */
      local_state: () => z.boolean().optional(),
    }),
  )
  .strict();

export const ExtensionEventInput = z
  .object(
    schemaFields({
      event: () => Name,
      id: () => z.string().min(1).max(160),
      data: () =>
        z
          .record(
            z.string().min(1).max(80),
            z.union([z.string().max(1000), z.number().finite(), z.boolean(), z.null()]),
          )
          .refine((v) => Object.keys(v).length <= 30, "too many fields"),
    }),
  )
  .strict();
export type ExtensionEventInput = z.infer<typeof ExtensionEventInput>;

export const ExtensionEventConfig = z
  .object(
    schemaFields({
      enabled: () => z.boolean(),
      thread: () => z.string().min(1).max(100),
      /** Local minutes since midnight; equal endpoints mean no quiet hours. */
      quiet_start: () => z.number().int().min(0).max(1439).default(0),
      quiet_end: () => z.number().int().min(0).max(1439).default(0),
      time_zone: () => z.string().min(1).max(80).default("UTC"),
    }),
  )
  .strict();
export type ExtensionEventConfig = z.infer<typeof ExtensionEventConfig>;

const Receipt = z.object({ receipt: z.string(), duplicate: z.boolean() });
export const extensionEventMethods = {
  "extensions.events_get": deferMethod({
    params: () => z.object({ id: z.string().max(20) }).strict(),
    result: () =>
      z.object({
        config: ExtensionEventConfig.optional(),
        pending: z.number(),
        error: z.string().optional(),
        targets: z.array(z.object({ id: z.string(), title: z.string().nullable() })),
      }),
    effect: false,
  }),
  "extensions.events_set": deferMethod({
    params: () => z.object({ id: z.string().max(20), config: ExtensionEventConfig }).strict(),
    result: () => z.object({ ok: z.boolean() }),
    effect: true,
    access: "human",
  }),
  "extensions.events_emit": deferMethod({
    params: () => z.object({ extension: z.string().max(20), input: ExtensionEventInput }).strict(),
    result: () => Receipt,
    effect: true,
    access: "human",
  }),
} as const;
