import type { NewsEntry } from "./entries.ts";

export const ACTIVITY_REVIEW_HISTORY_NEWS: NewsEntry = {
  id: "activity-review-history",
  since: "2.17.2",
  title: { en: "What each review found", es: "Qué encontró cada revisión" },
  about: {
    en: "Settings › Review and improvements now lists past reviews: when each ran, how many chats it read and each improvement it suggested, with whether you accepted, finished or dropped it. You can also ask what it suggested this week.",
    es: "Configuración › Revisión y mejoras ahora muestra las revisiones anteriores: cuándo se hizo cada una, cuántas charlas leyó y cada mejora que sugirió, con si la aceptaste, la terminaste o la descartaste. También podés preguntar qué sugirió esta semana.",
  },
  applies: () => true,
  text:
    "Activity review now keeps a history. Read it with apx_settings method activity_review.history (limit, before): " +
    "each review's time, how many chats and owner messages it read and from when, and each proposal with its outcome " +
    "(pending to decide, accepted, done, dropped, deleted) and its task link apx:tasks/<id>. " +
    "Offer to summarize what the reviews suggested lately and what is still to decide, linking the tasks. " +
    "Reviews made before this release show their proposals without what they read. The panel is apx:settings/activity-review.",
  actions: [
    {
      label: { en: "What did it suggest this week?", es: "¿Qué sugirió esta semana?" },
      prompt: "What improvements did activity review suggest this week, and which are still waiting for me?",
    },
  ],
};
