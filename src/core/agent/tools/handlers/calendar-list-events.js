import * as calendar from "#core/integrations/plugins/calendar.js";
import { resolveCalendar, PROJECT_ARG, todayWindow } from "./_calendar.js";

export default {
  name: "calendar_list_events",
  category: "integrations",
  schema: {
    type: "function",
    function: {
      name: "calendar_list_events",
      description:
        "What is on the calendar. Defaults to the rest of today when no window is given.",
      parameters: {
        type: "object",
        properties: {
          time_min: { type: "string", description: "ISO start of the window (default: now)" },
          time_max: { type: "string", description: "ISO end of the window (default: end of today)" },
          q: { type: "string", description: "free-text search over the events" },
          max_results: { type: "number", description: "default 25" },
          ...PROJECT_ARG,
        },
        required: [],
      },
    },
  },
  makeHandler: ({ projects }) => async ({ project, time_min, time_max, q, max_results = 25 } = {}) => {
    const { config, calendarId } = resolveCalendar(projects, project);
    const window = todayWindow();
    return {
      events: await calendar.listEvents(config, {
        calendarId,
        timeMin: time_min || window.timeMin,
        timeMax: time_max || window.timeMax,
        q,
        maxResults: max_results,
      }),
    };
  },
};
