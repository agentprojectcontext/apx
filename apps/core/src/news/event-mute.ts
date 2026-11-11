import type { NewsEntry } from "./entries.ts";

// Told once to an owner with Calendar's event reminders on: a repeating event they need no reminder of can be muted.
export const EVENT_MUTE_NEWS: NewsEntry = {
  id: "event-mute",
  since: "2.14.0",
  title: {
    en: "Stop reminders of an event",
    es: "Dejar de recibir avisos de un evento",
  },
  about: {
    en:
      "A Calendar reminder you do not need, like a daily break, can be turned off from the reminder itself: that " +
      "event and every later one of its series stop being told. Google Calendar's settings list them to turn back on.",
    es:
      "Un aviso del calendario que no necesitás, como una pausa diaria, se puede apagar desde el mismo aviso: ese " +
      "evento y los siguientes de la serie dejan de avisarse. La configuración de Google Calendar los lista para volver " +
      "a activarlos.",
  },
  applies: (facts) => Boolean(facts.eventReminders),
  text:
    "The owner can stop event reminders of one Google Calendar event and the rest of its series: from the reminder " +
    "in the tray, or by asking you. apx_settings integrations.mute_event with series (an event's series from the " +
    "calendar listing, or its id when it has none), title and muted true stops them; muted false resumes them, and " +
    "integrations.settings for google-calendar lists the muted ones. Offer it when the owner finds a repeating " +
    "reminder (a daily break, a weekly standup) noise; mute nothing until they say which.",
  actions: [
    {
      label: { en: "Quiet a reminder", es: "Silenciar un aviso" },
      prompt:
        "Look at my calendar for repeating events I get reminders of and ask me which ones to stop. Change nothing " +
        "until I say so.",
    },
  ],
};
