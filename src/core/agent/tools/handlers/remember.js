import { appendSelfMemory } from "#core/agent/self-memory.js";
import { appendProjectMemory } from "#core/apc/project-memory.js";
import { appendRoutineMemory, resolveRoutineStorage } from "#core/stores/routine-memory.js";
import { looksDurable } from "#core/memory/consolidate.js";
import { resolveProject, projectMeta } from "../helpers.js";
import { CHANNELS } from "#core/constants/channels.js";

// Write a durable note into YOUR OWN notebook (~/.apx/memory.md) — or, with
// `project`, into that project's own memory (<repo>/.apc/memory.md). This is
// durable memory, not a project task and not an agent memory.
//
// The `project` scope exists because a fact about ONE repo does not belong in a
// notebook that ships in every prompt on every channel, and because without it
// the model had no way at all to write project memory: asked to record what a
// dozen projects were, it invented a `MEMORY.md` at each repo root, which the
// Memories screen does not read and the RAG indexer does not see. A note now
// lands where the reader already looks.
//
// Routine runs get one extra judgement: the notebook ships in every prompt on
// every channel forever, and a scheduled routine calling `remember` each run
// ("today's weather is -8°C", "the routine ran and sent a message") turned it
// into a daily log — sixty days of weather is zero facts. So inside a routine,
// a note that does not read as a durable owner-level fact (looksDurable, the
// same judgement consolidation applies) is diverted to that routine's own
// memory instead of the global notebook. Durable facts still land globally.
export default {
  name: "remember",
  schema: {
    type: "function",
    function: {
      name: "remember",
      description:
        "Save a durable fact. Without `project` it goes to your cross-channel notebook (~/.apx/memory.md) so you still know it in future sessions AND on other channels (telegram, web, deck, voice); with `project` it goes to THAT project's own memory (<repo>/.apc/memory.md), which is what its Memories screen shows — never write a memory file yourself, this tool is the only correct way to put one there. Use it at the END of any turn where something important happened: a decision taken, a task completed, a key datum agreed, or a relevant tool result. NOT for one-off TODOs (use create_task), NOT for project-agent memory, and NOT for ephemeral data that ages out within a day (today's weather, a routine's run summary) — inside a routine those belong in `remember_routine`, and non-durable notes are diverted there automatically. Keep each note to one self-contained sentence.",
      parameters: {
        type: "object",
        required: ["note"],
        properties: {
          note: {
            type: "string",
            description:
              "One durable, self-contained fact to remember, in the owner's language. e.g. 'Manu prefers terse replies with no trailing summaries'.",
          },
          channel: {
            type: "string",
            description:
              "Optional: the channel this happened on (telegram, web, deck, voice…). Usually leave it empty — the current channel is tagged automatically.",
          },
          project: {
            type: "string",
            description:
              "Optional: project id, name or path. Give it when the fact is about ONE project (what it is, its stack, who owns it, a decision taken in it) — the note lands in that project's memory instead of your notebook. Leave it empty for facts that matter on every channel.",
          },
        },
      },
    },
  },
  makeHandler: (ctx = {}) => ({ note, channel, project } = {}) => {
    if (!note || !String(note).trim()) return { error: "note required" };
    const text = String(note).trim();
    try {
      // An explicit project wins over the routine divert below: the model has
      // said where this belongs, and a project fact is durable by definition.
      if (project !== undefined && project !== null && String(project).trim()) {
        let p;
        try {
          p = resolveProject(ctx.projects, String(project).trim());
        } catch (e) {
          return { error: e.message };
        }
        const meta = projectMeta(ctx.projects, p);
        const r = appendProjectMemory(p.path, text, {
          channel: channel || ctx.channel || "",
          projectName: meta.name,
        });
        return { saved: true, scope: "project", project: meta.name, note: text, path: r.path };
      }

      const routineId = ctx.channelMeta?.routineId;
      if (ctx.channel === CHANNELS.ROUTINE && routineId && !looksDurable(text)) {
        // Divert, don't drop — and if storage can't be resolved, fall through
        // to the global save: a misplaced note beats a lost one.
        const storagePath = resolveRoutineStorage(ctx.projects, ctx.channelMeta?.projectPath || "");
        if (storagePath) {
          const routineName = ctx.channelMeta?.routineName || "";
          appendRoutineMemory(storagePath, routineId, text, { routineName });
          return {
            saved: true,
            scope: "routine",
            routine: routineName || routineId,
            note: text,
            hint:
              "not a durable owner-level fact — saved to this routine's own memory, not the global notebook. Use `remember` only for facts worth knowing on every channel.",
          };
        }
      }
      const r = appendSelfMemory(text, { channel: channel || ctx.channel || "" });
      return { saved: true, note: r.note };
    } catch (e) {
      return { error: e?.message || String(e) };
    }
  },
};
