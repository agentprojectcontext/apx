import { appendSelfMemory } from "#core/agent/self-memory.js";
import { appendRoutineMemory, resolveRoutineStorage } from "#core/stores/routine-memory.js";
import { looksDurable } from "#core/memory/consolidate.js";
import { CHANNELS } from "#core/constants/channels.js";

// Write a durable note into YOUR OWN notebook (~/.apx/memory.md). This is your
// personal, cross-session memory — not a project task and not an agent memory.
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
        "Save a durable fact to your cross-channel notebook (~/.apx/memory.md) so you still know it in future sessions AND on other channels (telegram, web, deck, voice). Use it at the END of any turn where something important happened: a decision taken, a task completed, a key datum agreed, or a relevant tool result — anything you'd want to know if the owner brought it up from a different channel. NOT for one-off TODOs (use create_task), NOT for project-agent memory, and NOT for ephemeral data that ages out within a day (today's weather, a routine's run summary) — inside a routine those belong in `remember_routine`, and non-durable notes are diverted there automatically. Keep each note to one self-contained sentence.",
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
        },
      },
    },
  },
  makeHandler: (ctx = {}) => ({ note, channel } = {}) => {
    if (!note || !String(note).trim()) return { error: "note required" };
    const text = String(note).trim();
    try {
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
