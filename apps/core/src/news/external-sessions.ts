import type { NewsEntry } from "./entries.ts";

export const EXTERNAL_SESSIONS_NEWS: NewsEntry = {
  id: "start-external-session",
  since: "2.13.0",
  title: { en: "Ask for an external session", es: "Pedí una sesión externa" },
  about: {
    en: "Ask your agent to open an external coding session in a project. It stays visible in APX, with the engine's default model or the model you choose.",
    es: "Pedile a tu agente que abra una sesión externa de código en un proyecto. Queda visible en APX, con el modelo predeterminado del motor o el que vos elijas.",
  },
  applies: (facts) => Boolean(facts.claude || facts.codex),
  text: "Use start_session to open a visible external-engine chat in a registered project and send its first task. Omit model for that engine's own default, or pass the full engine/model#effort reference. It keeps the caller's permissions and reports its result back. This is not an agent delegation or a standalone shell. Read its chat id with read_chat for context; do not launch duplicate sessions to check progress.",
  actions: [
    {
      label: { en: "Ask for a code review", es: "Pedir una revisión de código" },
      prompt: "Open a read-only external session to review this project's code, using the engine's default model.",
    },
  ],
};
