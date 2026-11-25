import type { NewsEntry } from "./entries.ts";

export const HELPER_MODEL_NEWS: NewsEntry = {
  id: "helper-model",
  since: "2.17.0",
  title: { en: "Pick the helper model and its backups", es: "Elegí el modelo ayudante y sus respaldos" },
  about: {
    en: "Settings › Helper model shows everything the small background model does (titles, summaries, memory, which mail and group messages matter, images, drafts) and lets you pick it with backups in order, so your main model is not spent on small jobs.",
    es: "Configuración › Modelo ayudante muestra todo lo que hace el modelo chico de fondo (títulos, resúmenes, memoria, qué mails y mensajes de grupos importan, imágenes, borradores) y te deja elegirlo con respaldos en orden, así tu modelo principal no se gasta en tareas chicas.",
  },
  applies: () => true,
  text:
    "The helper model (the auxiliary model) has its own Settings section now, at apx:settings/helper-model, instead of " +
    "the bottom of Memory. It lists every background job it runs: chat titles and summaries, automatic memory, judging " +
    "mail and group messages, describing images, picking who answers in a group chat, drafts, activity review and " +
    "standing in for an agent's model in short notices. In Chosen mode the owner picks an ordered list: the first model " +
    "first, then each backup. Only the owner sets it, from that screen. Offer to look at which small, fast models they " +
    "have connected (a small model from their ChatGPT plan, a local one) and suggest a list they can set there.",
  actions: [
    {
      label: { en: "Suggest a helper model", es: "Sugerime un modelo ayudante" },
      prompt:
        "Look at the models I have connected and suggest a small, fast helper model with a backup; give me the link to set it.",
    },
  ],
};
