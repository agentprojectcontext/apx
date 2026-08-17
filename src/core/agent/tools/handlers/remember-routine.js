import { appendRoutineMemory } from "#core/stores/routine-memory.js";

/**
 * A routine writing to its OWN memory.
 *
 * WHY THIS TOOL EXISTS. Routine memory is a file, and until now the only way to
 * write it was `write_file` — which is gated as dangerous, correctly, because it
 * can write anywhere. In a routine there is nobody to confirm anything, so
 * `requirePermission` threw "Action requires user confirmation", the model
 * treated it as a dead end, and the evening anchor ended without sending
 * anything. The run still reported `ok`, so the only symptom was silence.
 *
 * An agent recording what it learned is not a dangerous act. It is the most
 * ordinary thing it does, and it must not need a human standing by.
 *
 * WHY IT IS SAFE UNGATED: there is no path argument. The destination comes from
 * the running routine's own context (channelMeta.routineId + the project's
 * storage), so this tool cannot write anywhere else however it is called. That
 * is the whole difference between this and write_file, and it is the reason the
 * permission is unnecessary rather than merely inconvenient.
 */
export default {
  name: "remember_routine",
  schema: {
    type: "function",
    function: {
      name: "remember_routine",
      description:
        "Save a durable note to THIS routine's own memory — what you learned about how the " +
        "owner works, what turned out to be worth mentioning, what turned out to be noise. " +
        "Only available while a routine is running. Use this instead of write_file: it is the " +
        "routine's own notebook and needs no permission. For facts about the owner that matter " +
        "on every channel, use `remember` instead.",
      parameters: {
        type: "object",
        required: ["note"],
        properties: {
          note: {
            type: "string",
            description: "One line. A judgement that will change what you do next time, not a log of what happened.",
          },
        },
      },
    },
  },
  makeHandler: ({ channel, channelMeta, projects }) => async ({ note } = {}) => {
    const text = String(note || "").trim();
    if (!text) return { error: "note required" };

    const routineId = channelMeta?.routineId;
    const routineName = channelMeta?.routineName || "";
    if (!routineId) {
      // Said plainly so the model reaches for `remember` instead of retrying.
      return {
        error:
          "remember_routine only works inside a running routine. " +
          "Use `remember` for a durable fact about the owner.",
        channel: channel || null,
      };
    }

    // The routine's project storage, never a model-supplied path.
    const projectPath = channelMeta?.projectPath || "";
    let storagePath = "";
    for (const entry of projects?.list?.() || []) {
      if (projectPath && entry.path !== projectPath) continue;
      storagePath = projects.get(entry.id)?.storagePath || "";
      if (storagePath) break;
    }
    if (!storagePath) return { error: "could not resolve this routine's storage" };

    try {
      const r = appendRoutineMemory(storagePath, routineId, text, { routineName });
      return { saved: true, routine: routineName || routineId, note: text, path: r?.path };
    } catch (e) {
      return { error: e.message };
    }
  },
};
