import { listRoutines, getRoutine } from "#core/stores/routines.js";
import { summarizeToolTrace } from "#core/agent/tool-summary.js";
import { resolveProject } from "../helpers.js";

// Run a routine on demand and WAIT for its verdict.
//
// The alternative was `run_shell("apx routine run …")`, and that is how it was
// being done: through the CLI, through the daemon, with the routine's whole
// stdout landing in the turn — plus, for anything the CLI could not express,
// python heredocs that rewrote routines.json by hand. One tool call replaces
// all of it, and the model gets back a verdict instead of a transcript.
//
// Blocking is the point. A routine is a job with an end: the agent says "voy a
// correr la rutina", stops, and speaks again when there is something to report.
// Polling in a tool loop would spend an iteration and a slice of context per
// check and still be slower.
const REPLY_CAP = 1500;

export default {
  name: "run_routine",
  schema: {
    type: "function",
    function: {
      name: "run_routine",
      description:
        "Run one of a project's routines NOW and wait until it finishes. Returns " +
        "its verdict (ok / error), what it reported, and which tools it used. " +
        "Blocking: nothing else happens in this turn until the routine ends, so " +
        "tell the user you are launching it before you call this. Use it to test " +
        "a routine you just created or to trigger a scheduled job early. Use " +
        "list_routines first if you are unsure of the name.",
      parameters: {
        type: "object",
        properties: {
          routine: { type: "string", description: "Routine name (exact, from list_routines)." },
          project: { type: "string", description: "Project id, name or path. Omit for the default project." },
        },
        required: ["routine"],
      },
    },
  },
  makeHandler: ({ projects, plugins, registries, globalConfig, requirePermission }) =>
    async ({ routine: name, project } = {}) => {
      if (!name) return { error: "run_routine: routine is required" };
      // A routine runs with permission_mode "total" by design (a cron has
      // nobody to ask), so triggering one from chat is a real side effect.
      await requirePermission("run_routine", { dangerous: true, args: { routine: name, project } });

      const p = resolveProject(projects, project);
      if (!p) return { error: `project not found: ${project}` };

      const r = getRoutine(p.storagePath, name);
      if (!r) {
        return {
          error: `routine "${name}" not found in project ${p.name || p.path}`,
          available: listRoutines(p.storagePath).map((x) => x.name),
        };
      }

      // Imported here, not at module scope: the runner imports the tool
      // registry (a routine runs a tool loop) and the registry imports this
      // handler, so a static import closes the cycle and one of the two ends
      // up half-initialised. Deferring to call time breaks it.
      const { runRoutineNow } = await import("#core/routines/runner.js");

      let out;
      try {
        out = await runRoutineNow(
          { project: p, projects, plugins, registries, globalConfig, trigger: "agent" },
          r
        );
      } catch (e) {
        return { routine: name, status: "error", error: e.message };
      }

      const reply = String(out?.reply || out?.text || "");
      return {
        routine: name,
        project: p.name || p.path,
        status: out?.status === "error" ? "error" : "ok",
        ...(out?.skipped ? { skipped: true, note: out.note } : {}),
        ...(out?.error ? { error: String(out.error).slice(0, 600) } : {}),
        ...(out?.blocked_tools?.length ? { blocked_tools: out.blocked_tools } : {}),
        // What it said, capped: the routine's own ledger and conversation hold
        // the full text, and this is a status report, not a transcript.
        reply: reply.length > REPLY_CAP ? reply.slice(0, REPLY_CAP) + "…(truncated)" : reply,
        // Counts, not arguments — enough to tell "it worked" from "it narrated".
        ...(summarizeToolTrace(out?.trace) ? { tools_used: summarizeToolTrace(out.trace) } : {}),
        ...(out?.conversation_id ? { conversation_id: out.conversation_id } : {}),
        last_run_at: out?.last_run_at,
        next_run_at: out?.next_run_at,
      };
    },
};
