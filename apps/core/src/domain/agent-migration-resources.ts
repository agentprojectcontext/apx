import { qb, type Sql } from "./sql.ts";

const object = (text: string): Record<string, unknown> => JSON.parse(text) as Record<string, unknown>;

export function migrationResources(q: Sql, source: string, agent: string, threads: Set<string>, tasks: string[]) {
  const attachments = q.all(qb.selectFrom("task_attachments").selectAll()).filter((a) => tasks.includes(a.task_id));
  const media = q
    .all(qb.selectFrom("media").selectAll())
    .filter((m) => (m.thread_id && threads.has(m.thread_id)) || attachments.some((a) => a.media_id === m.id));
  const flows = q.all(qb.selectFrom("flows").selectAll().where("project_id", "=", source));
  const bindings = new Set(flows.filter((f) => object(f.action).agent === agent).map((f) => f.id));
  for (const draft of q.all(qb.selectFrom("flow_graph_drafts").select(["flow_id", "graph"]))) {
    if (!flows.some((f) => f.id === draft.flow_id)) continue;
    const nodes = object(draft.graph).nodes;
    if (
      Array.isArray(nodes) &&
      nodes.some((n: unknown) => n && typeof n === "object" && "agent" in n && n.agent === agent)
    )
      bindings.add(draft.flow_id);
  }
  for (const revision of q.all(qb.selectFrom("flow_graph_revisions").select(["flow_id", "graph"]))) {
    if (!flows.some((f) => f.id === revision.flow_id)) continue;
    const nodes = object(revision.graph).nodes;
    if (
      Array.isArray(nodes) &&
      nodes.some((n: unknown) => n && typeof n === "object" && "agent" in n && n.agent === agent)
    )
      bindings.add(revision.flow_id);
  }
  return {
    media,
    attachments,
    flow_bindings: [...bindings].sort(),
    source_attachment_copies: attachments
      .filter((a) => a.source_thread_id && !threads.has(a.source_thread_id))
      .map((a) => a.source_media_id)
      .sort(),
  };
}
