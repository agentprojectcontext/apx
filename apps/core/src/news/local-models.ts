import type { NewsEntry } from "./entries.ts";

export const LOCAL_MODELS_NEWS: NewsEntry = {
  id: "local-models",
  since: "2.13.0",
  title: { en: "Models on this computer, ready to use", es: "Modelos de esta computadora, listos para usar" },
  about: {
    en:
      "APX found a model app running on this computer. Its chat models are in Settings › Engines and models, free and " +
      "ready to pick for an agent, with nothing to set up.",
    es:
      "APX encontró una app de modelos abierta en esta computadora. Sus modelos de chat están en Configuración › " +
      "Motores y modelos, gratis y listos para elegir para un agente, sin configurar nada.",
  },
  applies: (f) => f.localModels === true,
  text:
    "APX now finds Ollama and LM Studio when they run on the owner's computer and offers their chat models as a " +
    "provider with no setup: one row per app in Settings › Engines and models, marked as on this computer and free. " +
    "They run through APX's own loop like any provider model and cost nothing per call, but they are slower and less " +
    "capable than the big hosted models, so they suit light agents, private drafts and quick summaries. When the app " +
    "is closed its models show as unavailable and an agent using one fails until it is opened again. Offer to put one " +
    "on an agent the owner picks, with their OK.",
  actions: [
    {
      label: { en: "Which agent could use one?", es: "¿Qué agente podría usarlo?" },
      prompt:
        "Look at the models found on this computer and tell me in a few lines which of my agents could run on one " +
        "without losing much, and why. Change nothing unless I say so.",
    },
  ],
};
