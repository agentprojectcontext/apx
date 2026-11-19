import { z } from "zod";
import { deferMethod } from "./defer-method.ts";

const references = z.array(z.string());
const selection = {
  agent: z.string().min(1),
  destination: z.string().min(1),
  paths: z.array(z.string().min(1)).default([]),
};

export const AgentMigrationInventory = z
  .object({
    agent: z.string(),
    source: z.string(),
    destination: z.string(),
    tasks: references,
    detached_tasks: references,
    threads: references,
    detached_threads: references,
    memories: references,
    routines: references,
    surfaces: references,
    media: references,
    source_attachment_copies: references,
    flow_bindings: references,
    permissions_reset: z.number().int().nonnegative(),
    shared_tasks: references,
    shared_threads: references,
    blockers: references,
    revision: z.string().min(1),
  })
  .strict();

export const AgentMigrationPreview = AgentMigrationInventory.extend({
  id: z.uuid(),
  source_name: z.string(),
  destination_name: z.string(),
  paths: references,
  files: z.array(
    z
      .object({
        from: z.string(),
        to: z.string(),
        digest: z.string(),
        bytes: z.number().int().nonnegative(),
        mode: z.number().int(),
        kind: z.enum(["work", "artifacts", "artifact-sources"]),
      })
      .strict(),
  ),
  detached_agents: z.array(z.object({ id: z.string(), name: z.string() }).strict()),
  connections_left: references,
  binding_changes: z.array(z.object({ connection: z.string(), variables: z.array(z.string()) }).strict()),
  destination_agents: z.array(z.object({ id: z.string(), name: z.string() }).strict()),
  source_root: z.string(),
  destination_root: z.string(),
}).strict();

export const agentMigrationMethods = {
  "agents.migration_preview": deferMethod({
    params: () => z.object(selection).strict(),
    result: () => AgentMigrationPreview,
    effect: false,
    access: "human",
  }),
  "agents.migrate": deferMethod({
    params: () => z.object({ ...selection, id: z.uuid(), revision: z.string().min(1) }).strict(),
    result: () =>
      z
        .object({
          id: z.uuid(),
          state: z.enum(["committed", "restored"]),
          at: z.string(),
          inventory: AgentMigrationInventory,
        })
        .strict(),
    effect: true,
    access: "human",
  }),
  "agents.migration_recover": deferMethod({
    params: () => z.object({ id: z.uuid() }).strict(),
    result: () => z.object({ id: z.uuid(), restored: z.literal(true) }).strict(),
    effect: true,
    access: "human",
  }),
} as const;
