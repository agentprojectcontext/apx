import * as calendar from "#core/integrations/plugins/calendar.js";
import { resolveCalendar, PROJECT_ARG } from "./_calendar.js";

export default {
  name: "calendar_create_event",
  category: "integrations",
  schema: {
    type: "function",
    function: {
      name: "calendar_create_event",
      description: "Put an event on the calendar. Times are ISO 8601 with an offset.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          start: { type: "string", description: "ISO start, e.g. 2026-08-19T15:00:00-03:00" },
          end: { type: "string", description: "ISO end" },
          description: { type: "string" },
          location: { type: "string" },
          attendees: { type: "array", items: { type: "string" }, description: "email addresses — they get a real invitation" },
          meet: { type: "boolean", description: "add a Google Meet video link (defaults to the connection's preference)" },
          confirmed: { type: "boolean", description: "set once the user has approved this write" },
          ...PROJECT_ARG,
        },
        required: ["title", "start", "end"],
      },
    },
  },
  // An event lands in someone's day, and with attendees it lands in several.
  // That is an outward-facing write and it confirms first, like send_telegram.
  makeHandler: ({ projects, requirePermission }) => async ({ project, title, start, end, description, location, attendees, meet, confirmed = false } = {}) => {
    await requirePermission("calendar_create_event", { dangerous: true, confirmed, args: { title, start } });
    const { config, calendarId } = resolveCalendar(projects, project, { needsWrite: true });
    // Default the Meet link to the connection's preference; an explicit arg wins.
    const withMeet = meet ?? !!config.meet;
    return { event: await calendar.createEvent(config, { calendarId, title, start, end, description, location, attendees, meet: withMeet }) };
  },
};
