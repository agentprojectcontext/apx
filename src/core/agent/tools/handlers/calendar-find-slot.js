import * as calendar from "#core/integrations/plugins/calendar.js";
import { resolveCalendar, PROJECT_ARG, todayWindow } from "./_calendar.js";

export default {
  name: "calendar_find_slot",
  category: "integrations",
  schema: {
    type: "function",
    function: {
      name: "calendar_find_slot",
      description:
        "Free gaps of at least N minutes in a window. Computed from the calendar's busy blocks, not guessed.",
      parameters: {
        type: "object",
        properties: {
          minutes: { type: "number", description: "how long the gap must be (default 30)" },
          time_min: { type: "string", description: "ISO start of the search window (default: now)" },
          time_max: { type: "string", description: "ISO end of the search window (default: end of today)" },
          limit: { type: "number", description: "how many gaps to return (default 5)" },
          ...PROJECT_ARG,
        },
        required: [],
      },
    },
  },
  makeHandler: ({ projects }) => async ({ project, minutes = 30, time_min, time_max, limit = 5 } = {}) => {
    const { config, calendarId } = resolveCalendar(projects, project);
    const window = todayWindow();
    return {
      slots: await calendar.findSlots(config, {
        calendarId,
        timeMin: time_min || window.timeMin,
        timeMax: time_max || window.timeMax,
        minutes,
        limit,
      }),
    };
  },
};
