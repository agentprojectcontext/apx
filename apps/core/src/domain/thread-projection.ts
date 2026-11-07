import type { Thread } from "@apx/protocol";
import type { Selectable } from "kysely";
import type { ThreadsTable } from "../db/schema.ts";
import { opt } from "./sql.ts";
import type { ThreadContext } from "./threads.ts";

/** What a chat's context shows outside: the model picked in its composer, the release it tells about, a helper's name. */
function fromContext(context: string): Pick<Thread, "model_choice" | "release" | "flow" | "worker"> {
  try {
    const c = JSON.parse(context) as ThreadContext;
    const flow = c.flow_step?.flow;
    return {
      ...(c.model_choice ? { model_choice: c.model_choice } : {}),
      ...(c.release ? { release: c.release.version } : {}),
      ...(flow ? { flow: { id: flow, ...(c.flow_step?.node ? { step: c.flow_step.node } : {}) } } : {}),
      ...(c.worker ? { worker: c.worker.name } : {}),
    };
  } catch {
    return {};
  }
}

export const toThread = (r: Selectable<ThreadsTable> & { routine_id?: string | null }): Thread => ({
  id: r.id,
  kind: r.kind as Thread["kind"],
  title: r.custom_title ?? r.title,
  ...(r.custom_title ? { auto_title: r.title } : {}),
  ...(r.pinned ? { pinned: true } : {}),
  ...(r.archived ? { archived: true } : {}),
  agent_ids: JSON.parse(r.agent_ids) as string[],
  ...opt("project_id", r.project_id),
  ...opt("parent_id", r.parent_id),
  ...opt("task_id", r.task_id),
  ...opt("routine_id", r.routine_id),
  ...opt("session", r.session),
  ...opt("cwd", r.cwd),
  ...opt("engine", r.engine),
  ...(r.write_policy ? { write: r.write_policy as NonNullable<Thread["write"]> } : {}),
  ...(r.channel
    ? {
        channel: {
          id: r.channel,
          conversation: String(r.conversation),
          ...opt("person_id", r.person_id),
        },
      }
    : {}),
  ...fromContext(r.context),
  state: r.state as Thread["state"],
  preview: r.preview,
  unread: Number(r.unread),
  created_at: r.created_at,
  updated_at: r.updated_at,
});
