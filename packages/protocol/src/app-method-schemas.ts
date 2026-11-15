import { z } from "zod";
import { Id, OutboxState } from "./domain.ts";
import { schemaFields } from "./schema-fields.ts";

/** The parts of APX v1 the setup can bring in. */
export const V1Group = z.enum([
  "projects",
  "skills",
  "keys",
  "vars",
  "mcps",
  "memory",
  "embeddings",
  "services",
  "identity",
  "chats",
  "channels",
  "tasks",
  "commitments",
  "routines",
]);

/**
 * What an agent's message on a channel left: its chat, the end of that chat before it (so the agent knows what was
 * already said), and how the send went after a few seconds (refused: `failed` with the platform's reason; a channel
 * that is down: still `queued`).
 */
export const Sent = z.object(
  schemaFields({
    thread: () => Id,
    channel: () => z.string(),
    recent: () =>
      z.array(
        z.object(
          schemaFields({
            from: () => z.enum(["them", "you", "owner"]),
            text: () => z.string(),
          }),
        ),
      ),
    delivery: () =>
      z.object(
        schemaFields({
          state: () => OutboxState,
          error: () => z.string().optional(),
        }),
      ),
  }),
);

/**
 * A message to the owner that did not go to a chat app: held for quiet hours, dropped by their notice budget, or kept
 * in the app's tray because they chose to be told only in the app.
 */
export const Withheld = z.object(
  schemaFields({
    withheld: () => z.enum(["held", "dropped", "app_only"]),
  }),
);

export const MemoryJobs = z.array(
  z.object(
    schemaFields({
      id: () => Id,
      kind: () => z.string(),
      agent_id: () => Id,
      thread_id: () => Id,
      /** The project the job works in; none outside a project. */
      project_id: () => Id.nullable().optional(),
      state: () => z.string(),
      attempts: () => z.number().int(),
      updated_at: () => z.string(),
      result: () => z.string().nullable(),
      error: () => z.string().nullable(),
    }),
  ),
);
