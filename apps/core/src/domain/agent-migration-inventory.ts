import { createHash } from "node:crypto";
import { badRequest, notFound } from "../errors.ts";
import { migrationGrants } from "./agent-migration-grants.ts";
import { migrationResources } from "./agent-migration-resources.ts";
import { migrationWork } from "./agent-migration-scope.ts";
import { migrationRevision, migrationSnapshot } from "./agent-migration-snapshot.ts";
import { lineage, projectsRepo } from "./projects.ts";
import { qb, type Sql } from "./sql.ts";

/** The inventory contains references, never message bodies, prompts or memory text. */
export function agentMigrationInventory(q: Sql, agentId: string, destinationId: string) {
  const agent = q.one(qb.selectFrom("agents").selectAll().where("id", "=", agentId));
  if (agent?.archived !== 0) throw notFound("active agent");
  if (agent.kind === "secretary") throw badRequest("The super-agent cannot be moved");
  if (!agent.project_id || !agent.slug) throw badRequest("Choose an agent belonging to a project");
  if (agent.project_id === destinationId) throw badRequest("The agent already belongs to this project");
  const source = q.one(qb.selectFrom("projects").selectAll().where("id", "=", agent.project_id));
  const destination = q.one(qb.selectFrom("projects").selectAll().where("id", "=", destinationId));
  if (!source?.path || !destination?.path || !source.present || !destination.present || !destination.registered)
    throw badRequest("Both project folders must be available");

  const { threads, threadIds, selectedThreads, selectedTasks, detachedTasks, detachedThreads } = migrationWork(
    q,
    source.id,
    agentId,
  );
  const memories = q
    .all(qb.selectFrom("memories").selectAll())
    .filter(
      (m) =>
        (m.scope === "agent" && m.agent_id === agentId) ||
        ((m.project_id === source.id || m.scope === "global") && !!m.thread_id && threadIds.has(m.thread_id)),
    );
  const routines = q.all(qb.selectFrom("routines").selectAll().where("agent_id", "=", agentId));
  const surfaces = q
    .all(qb.selectFrom("surfaces").selectAll())
    .filter(
      (s) => s.project_id === source.id && (s.created_by === agentId || (!!s.thread_id && threadIds.has(s.thread_id))),
    );
  const resources = migrationResources(
    q,
    source.id,
    agentId,
    threadIds,
    selectedTasks.map((t) => t.id),
  );
  const grants = migrationGrants(q, { agent: agentId, threads: [...threadIds] });
  const blockers: string[] = [];
  const projects = projectsRepo(q, () => {});
  if (lineage(projects, source.id).includes(destinationId) || lineage(projects, destinationId).includes(source.id))
    blockers.push("inherited_scope");
  if (resources.flow_bindings.length) blockers.push("flow_binding");
  if (resources.attachments.some((a) => !resources.media.some((m) => m.id === a.media_id)))
    blockers.push("missing_attachment");
  if (
    q.one(qb.selectFrom("agents").select("id").where("project_id", "=", destinationId).where("slug", "=", agent.slug))
  )
    blockers.push("slug_conflict");
  if (selectedThreads.some((t) => t.project_id !== source.id)) blockers.push("cross_project_thread");
  if (selectedThreads.some((t) => t.channel || JSON.parse(t.context).client)) blockers.push("connected_chat");
  if (
    selectedThreads.some((t) => {
      const context = JSON.parse(t.context);
      return context.group || context.member_of;
    })
  )
    blockers.push("group_chat");
  if (
    surfaces.some((s) =>
      q.one(qb.selectFrom("surfaces").select("id").where("project_id", "=", destinationId).where("name", "=", s.name)),
    )
  )
    blockers.push("artifact_name_conflict");
  const sourceThreads = new Set(
    q.all(qb.selectFrom("threads").select("id").where("project_id", "=", source.id)).map((t) => t.id),
  );
  const sourceAgents = new Set(
    q.all(qb.selectFrom("agents").select("id").where("project_id", "=", source.id)).map((a) => a.id),
  );
  const owners = new Set(q.all(qb.selectFrom("agents").select("id").where("kind", "=", "secretary")).map((a) => a.id));
  if (
    q
      .all(qb.selectFrom("runs").select(["agent_id", "thread_id", "ended_at"]))
      .some(
        (r) =>
          !r.ended_at && !owners.has(r.agent_id) && (sourceAgents.has(r.agent_id) || sourceThreads.has(r.thread_id)),
      )
  )
    blockers.push("active_source_work");
  if (
    q
      .all(qb.selectFrom("runs").select(["agent_id", "thread_id", "ended_at"]))
      .some((r) => (r.agent_id === agentId || threadIds.has(r.thread_id)) && !r.ended_at)
  )
    blockers.push("active_run");
  if (
    q
      .all(qb.selectFrom("jobs").select(["thread_id", "ended_at"]))
      .some((j) => sourceThreads.has(j.thread_id) && !j.ended_at)
  )
    blockers.push("active_job");
  if (
    q
      .all(qb.selectFrom("memory_work").select(["agent_id", "thread_id", "project_id", "state"]))
      .some(
        (j) =>
          (j.agent_id === agentId || sourceThreads.has(j.thread_id) || j.project_id === source.id) &&
          j.state === "working",
      )
  )
    blockers.push("active_memory_work");
  if (surfaces.some((s) => s.share_token)) blockers.push("published_surface");
  const ids = <T extends { id: string }>(rows: T[]) => rows.map((r) => r.id).sort();
  const inventory = {
    agent: agentId,
    source: source.id,
    destination: destinationId,
    tasks: ids(selectedTasks),
    detached_tasks: ids(detachedTasks),
    threads: ids(selectedThreads),
    detached_threads: ids(detachedThreads),
    memories: ids(memories),
    routines: ids(routines),
    surfaces: ids(surfaces),
    media: ids(resources.media),
    source_attachment_copies: resources.source_attachment_copies,
    flow_bindings: resources.flow_bindings,
    permissions_reset: grants.reduce((n, g) => n + g.grants.length, 0),
    shared_tasks: selectedTasks
      .filter(
        (t) =>
          (t.assignee && t.assignee !== agentId) ||
          threads.some(
            (c) =>
              (c.task_id === t.id || c.id === t.thread_id) &&
              (JSON.parse(c.agent_ids) as string[]).some((id) => id !== agentId),
          ),
      )
      .map((t) => t.id)
      .sort(),
    shared_threads: selectedThreads
      .filter((t) => (JSON.parse(t.agent_ids) as string[]).some((id) => id !== agentId))
      .map((t) => t.id)
      .sort(),
    blockers,
  };
  const revision = createHash("sha256")
    .update(
      JSON.stringify({
        graph: migrationRevision(
          q,
          inventory,
          migrationSnapshot(q, inventory).agents.map((a) => a.id),
        ),
        agent,
        source,
        destination,
        selectedTasks,
        detachedTasks,
        selectedThreads,
        memories,
        routines,
        surfaces,
        resources,
        grants,
      }),
    )
    .digest("hex");
  return { ...inventory, revision };
}
