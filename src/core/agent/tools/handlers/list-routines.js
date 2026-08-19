import { listRoutines } from "#core/stores/routines.js";
import { resolveProject } from "../helpers.js";

// The routines a project has, and how their last run went. Pairs with
// run_routine: this answers "what can I run / did the 08:00 one fire", which
// otherwise took a shell round-trip through the CLI.
export default {
  name: "list_routines",
  schema: {
    type: "function",
    function: {
      name: "list_routines",
      description:
        "List a project's routines: name, kind, schedule, whether they are enabled, " +
        "and how the last run went. Use before run_routine, or to answer 'did the " +
        "cron run', 'qué rutinas tiene', 'por qué no corrió'.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string", description: "Project id, name or path. Omit for the default project." },
        },
      },
    },
  },
  makeHandler: ({ projects }) => async ({ project } = {}) => {
    const p = resolveProject(projects, project);
    if (!p) return { error: `project not found: ${project}` };
    return {
      project: p.name || p.path,
      routines: listRoutines(p.storagePath).map((r) => ({
        name: r.name,
        kind: r.kind,
        schedule: r.schedule,
        enabled: !!r.enabled,
        agent: r.spec?.agent || undefined,
        // An empty list means "no override — the agent's own tools"; say so
        // rather than printing [] and inviting the old misreading.
        tools: r.allowed_tools?.length ? r.allowed_tools.length : "agent default",
        last_run_at: r.last_run_at,
        last_status: r.last_status,
        ...(r.last_error ? { last_error: String(r.last_error).slice(0, 300) } : {}),
        next_run_at: r.next_run_at,
      })),
    };
  },
};
