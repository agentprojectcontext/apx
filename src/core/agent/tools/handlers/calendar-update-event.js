import * as calendar from "#core/integrations/plugins/calendar.js";
import { resolveCalendar, PROJECT_ARG } from "./_calendar.js";

export default {
  name: "calendar_update_event",
  category: "integrations",
  schema: {
    type: "function",
    function: {
      name: "calendar_update_event",
      description: "Move or edit an event. Only the fields given are changed.",
      parameters: {
        type: "object",
        properties: {
          event_id: { type: "string", description: "id from calendar_list_events" },
          title: { type: "string" },
          start: { type: "string", description: "ISO start" },
          end: { type: "string", description: "ISO end" },
          description: { type: "string" },
          location: { type: "string" },
          attendees: { type: "array", items: { type: "string" }, description: "email addresses — replaces the guest list and re-sends invites" },
          confirmed: { type: "boolean", description: "set once the user has approved this write" },
          ...PROJECT_ARG,
        },
        required: ["event_id"],
      },
    },
  },
  makeHandler: ({ projects, requirePermission }) => async ({ project, event_id, confirmed = false, ...fields } = {}) => {
    await requirePermission("calendar_update_event", { dangerous: true, confirmed, args: { event_id } });
    const { config, calendarId } = resolveCalendar(projects, project, { needsWrite: true });
    const { project: _ignored, ...patch } = fields;
    return { event: await calendar.updateEvent(config, { calendarId, eventId: event_id, ...patch }) };
  },
};
