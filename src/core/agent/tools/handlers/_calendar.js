// Shared helpers for the calendar agent tools (calendar-*.js). Underscore file,
// like _asana.js, so it carries no tool `name:` of its own: each tool stays a
// thin adapter over the pure client in core/integrations/plugins/calendar.js.
import { resolveProject } from "../helpers.js";
import { resolveIntegration } from "#core/integrations/index.js";

/**
 * The effective calendar config for a project, or an error the model can act
 * on. `calendar_id` is resolved here rather than in each tool: which calendar
 * is a connection detail the owner picked once, not a decision to re-take on
 * every call.
 */
export function resolveCalendar(projects, project, { needsWrite = false } = {}) {
  const p = resolveProject(projects, project);
  const resolved = resolveIntegration({ projectStorage: p.storagePath, slug: "calendar" });
  if (!resolved) {
    throw new Error(
      "No calendar is connected. Ask the user to connect one in the web panel → Integrations → Plugins → Google Calendar.",
    );
  }
  const config = resolved.record.config || {};
  const calendarId = config.calendar_id;
  if (!calendarId) {
    throw new Error("The calendar integration has no calendar selected. Pick one in the web panel.");
  }
  // Read-only is the default, and the agent finding out by way of a 403 from
  // Google is a worse answer than being told here.
  if (needsWrite && !config.write_access) {
    throw new Error(
      "This calendar is connected read-only. The user has to enable write access in the web panel → Integrations → Google Calendar before anything can be scheduled.",
    );
  }
  return { config, calendarId, scope: resolved.scope };
}

/** The optional `project` arg every calendar tool accepts. */
export const PROJECT_ARG = {
  project: { type: "string", description: "APX project id/name (optional; defaults to current)" },
};

/** Default window: from now to the end of the day, in the machine's timezone. */
export function todayWindow(now = new Date()) {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return { timeMin: now.toISOString(), timeMax: end.toISOString() };
}
