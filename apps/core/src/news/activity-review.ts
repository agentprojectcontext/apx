import type { NewsEntry } from "./entries.ts";

export const ACTIVITY_REVIEW_NEWS: NewsEntry = {
  id: "activity-review",
  since: "2.14.0",
  title: { en: "Review and improvements", es: "Revisión y mejoras" },
  about: {
    en: "APX can review new activity daily and suggest small improvements as proposals. It uses your auxiliary model only when there is activity. You can turn it off, choose weekly reviews or add details in Settings.",
    es: "APX puede revisar actividad nueva cada día y sugerir pequeñas mejoras como propuestas. Usa tu modelo auxiliar solo cuando hay actividad. Podés apagarlo, elegir revisiones semanales o agregar detalles en Configuración.",
  },
  applies: () => true,
  text:
    "APX now has a native Review and improvements setting, enabled daily by default, not an editable routine. " +
    "The first review is due after 24 hours; weekly means seven elapsed days, not a fixed local hour. " +
    "With new eligible owner activity it samples at most three project scopes in separate bounded auxiliary-model requests and creates only unassigned task proposals with evidence, acceptance criteria and limitations. " +
    "Without new activity or useful findings it stays silent. It never applies changes automatically. " +
    "Offer to change the frequency, disable it or add optional extra details through apx_settings activity_review.configure. " +
    "Extra details cannot override the versioned base prompt or permissions. The panel is at apx:settings/activity-review. " +
    "If the owner has a review routine already, explain that it remains separate; do not remove or change it without their request.",
  actions: [
    {
      label: { en: "Review weekly", es: "Revisar cada semana" },
      prompt: "Set native activity review to weekly and tell me what changed.",
    },
    {
      label: { en: "Turn off activity review", es: "Desactivar la revisión" },
      prompt: "Turn off native activity review. Keep my extra details for later.",
    },
  ],
};
