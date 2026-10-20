// Memory methods. The owner manages every note; an agent reads and writes only where its thread lets it: the owner's
// global notes, its thread's project and its own notebook. What an agent writes about the owner (global) waits for
// the owner to confirm it.
import type { Memory } from "@apx/protocol";
import { canUseChatMemory, memoryEligibleChat } from "../domain/chat-access.ts";
import { canSee, looksSecret, type MemoryView } from "../domain/memories.ts";
import { factSupported, procedureSupported } from "../domain/memory-content.ts";
import { evidenceIsLive, memoryClaimKey } from "../domain/memory-evidence.ts";
import { memorySettings } from "../domain/memory-settings.ts";
import { procedureEvidenceIsLive } from "../domain/memory-verification.ts";
import type { Store } from "../domain/store.ts";
import type { MemoryIndex } from "../engine/memory-index.ts";
import type { MemoryMaintenance } from "../engine/memory-maintenance.ts";
import { badRequest, notFound, unauthorized } from "../errors.ts";
import type { CallContext } from "./context.ts";
import { invalidateMemorySummaries, memoryAdminHandlers } from "./memory-admin.ts";
import type { Handlers } from "./router.ts";

export function memoryHandlers(store: Store, index: MemoryIndex, maintenance?: MemoryMaintenance) {
  /** The agent's view, or undefined for the owner (who sees everything). */
  const viewOf = (ctx: CallContext): MemoryView | undefined => {
    if (ctx.actor === "human") return undefined;
    if (!ctx.agent || !store.agents.list().some((a) => a.id === ctx.agent?.id))
      throw unauthorized("only the owner or an agent in a thread can use memory");
    return { agent_id: ctx.agent.id, project_id: store.threads.get(ctx.agent.thread_id)?.project_id };
  };

  /** The forgotten note with these words in this place, if any. */
  const forgottenTwin = (text: string, scope: Memory["scope"], project?: string, agent?: string) =>
    store.memories
      .list({
        forgotten: true,
        scope,
        project_id: scope === "project" ? project : undefined,
        agent_id: scope === "agent" ? agent : undefined,
        limit: 500,
      })
      .find((m) => m.text.trim().toLowerCase() === text.trim().toLowerCase());

  /** A new note gets indexed by meaning in the background (when that is on). */
  const indexed = (m: Memory) => {
    index.schedule();
    return m;
  };

  return {
    "memory.list": async ({ query, scope, project, agent, pending, forgotten, limit }, ctx) => {
      const view = viewOf(ctx);
      if (view && memorySettings(store).mode === "off") return { memories: [] };
      // An agent never sees what was forgotten.
      const filters = {
        view,
        scope,
        project_id: project,
        agent_id: agent,
        pending,
        forgotten: !view && forgotten,
        limit,
      };
      const found = query ? await index.search({ ...filters, query }) : store.memories.list(filters);
      const liveView = viewOf(ctx);
      if (liveView && memorySettings(store).mode === "off") return { memories: [] };
      return {
        memories: found.flatMap((note) => {
          const current = store.memories.get(note.id);
          if (
            !current ||
            Boolean(current.forgotten_at) !== Boolean(filters.forgotten) ||
            (liveView &&
              (!canSee(liveView, current) ||
                !canUseChatMemory(store, { id: ctx.agent?.thread_id, project_id: liveView.project_id }, current)))
          )
            return [];
          return [current];
        }),
      };
    },
    ...memoryAdminHandlers(store, index, maintenance),
    "memory.add": ({ text, scope, project, agent, id, tainted, kind, evidence, expected_revision }, ctx) => {
      if (looksSecret(text))
        throw badRequest("that looks like a password, key or token: memory never keeps credentials");
      const view = viewOf(ctx);
      if (view && memorySettings(store).mode === "off") throw badRequest("memory is disabled");
      if (view && store.memories.excluded(view, text)) throw badRequest("the owner asked to forget that");
      if (view && evidence?.length) {
        const quote = evidence.map((e) => e.quote).join("\n");
        const supported =
          kind === "procedure"
            ? procedureSupported(text, store.runs.steps(ctx.agent?.run_id ?? ""))
            : factSupported(text, quote);
        if (!supported || !ctx.memoryReviewed?.includes(memoryClaimKey(text, evidence)))
          throw badRequest("automatic memory must say only what its source supports");
        const thread = ctx.agent && store.threads.get(ctx.agent.thread_id);
        if (!thread || !memoryEligibleChat(store, thread)) throw unauthorized("memory source is not eligible");
        const sourceRun = ctx.agent && store.runs.get(ctx.agent.run_id);
        if (
          !sourceRun ||
          sourceRun.agent_id !== ctx.agent?.id ||
          sourceRun.thread_id !== thread.id ||
          (kind === "procedure"
            ? !procedureEvidenceIsLive(store, sourceRun, evidence)
            : !evidenceIsLive(store, sourceRun, evidence))
        )
          throw badRequest("invalid or forgotten memory evidence");
        if (scope !== "agent") throw badRequest("automatic memories stay private to this agent");
      }
      if (id) {
        const m = store.memories.get(id);
        if (!m) throw notFound(`memory ${id}`);
        if (view && (m.source === "owner" || !canSee(view, m)))
          throw unauthorized("an agent can only edit notes agents wrote that it can see");
        // The owner vouches for what they write; an agent's note is tainted unless its tool says the turn was clean,
        // and a note about the owner it rewrites waits for the owner again.
        const edited = store.memories.edit(id, text, {
          tainted: view ? (tainted ?? true) : false,
          pending: view ? m.scope === "global" : false,
          ...(expected_revision !== undefined ? { expectedRevision: expected_revision } : {}),
          ...(kind ? { kind } : {}),
          ...(evidence ? { evidence } : text !== m.text || !view ? { evidence: [] } : {}),
        });
        if (!edited) throw badRequest("memory changed; reload before editing");
        invalidateMemorySummaries(store);
        index.schedule();
        return edited;
      }
      if (!view) {
        const same = forgottenTwin(text, scope, project, agent);
        if (same) return indexed(store.memories.restore(same.id) ?? same);
        if (scope === "project" && !(project && store.projects.get(project)))
          throw badRequest("a project note needs a project");
        if (scope === "agent" && !(agent && store.agents.get(agent))) throw badRequest("an agent note needs an agent");
        return indexed(
          store.memories.add({
            scope,
            project_id: scope === "project" ? project : undefined,
            agent_id: scope === "agent" ? agent : undefined,
            text,
            source: "owner",
          }),
        );
      }
      // An agent writes only where it works: never for another project or another agent.
      if (scope === "project" && !view.project_id)
        throw badRequest("this thread has no project; use scope agent or global");
      if ((project && project !== view.project_id) || (agent && agent !== view.agent_id))
        throw unauthorized("an agent writes notes only for its own thread's project or for itself");
      if (forgottenTwin(text, scope, view.project_id, view.agent_id))
        throw badRequest("the owner asked to forget that; do not save it again");
      return indexed(
        store.memories.add({
          scope,
          project_id: scope === "project" || evidence?.length ? view.project_id : undefined,
          agent_id: scope === "agent" ? view.agent_id : undefined,
          text,
          source: "agent",
          author_agent: view.agent_id,
          thread_id: ctx.agent?.thread_id,
          run_id: ctx.agent?.run_id,
          tainted: tainted ?? true,
          pending: scope === "global",
          ...(kind ? { kind } : {}),
          ...(evidence ? { evidence } : {}),
        }),
      );
    },

    "memory.remove": ({ id, forever }, ctx) => {
      const m = store.memories.get(id);
      if (!m) return { removed: false };
      const view = viewOf(ctx);
      if (view && (m.source === "owner" || !canSee(view, m)))
        throw unauthorized("an agent can only remove notes agents wrote that it can see");
      if (forever && view) throw unauthorized("only the owner deletes a note for good");
      invalidateMemorySummaries(store);
      return { removed: forever ? store.memories.remove(id) : store.memories.forget(id) };
    },
    "memory.confirm": ({ id }) => {
      const m = store.memories.confirm(id);
      if (!m) throw notFound(`memory ${id}`);
      invalidateMemorySummaries(store);
      return indexed(m);
    },
    "memory.restore": ({ id }) => {
      const m = store.memories.restore(id);
      if (!m) throw notFound(`memory ${id}`);
      index.schedule();
      return m;
    },
  } satisfies Partial<Handlers>;
}
