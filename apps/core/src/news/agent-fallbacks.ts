import type { NewsEntry } from "./entries.ts";

export const AGENT_FALLBACKS_NEWS: NewsEntry = {
  id: "agent-fallbacks",
  since: "2.13.0",
  title: { en: "Fallback models for each agent", es: "Modelos de respaldo para cada agente" },
  about: {
    en: "An agent with a model of its own can have up to five fallback models. If its model hits its usage limit or does not answer, the agent moves to the first one on the list and goes back to its own model by itself once it is free.",
    es: "Un agente con modelo propio puede tener hasta cinco modelos de respaldo. Si su modelo llega al límite de uso o no responde, el agente pasa al primero de la lista y vuelve solo al suyo cuando se libera.",
  },
  applies: (facts) => (facts.ownModels ?? 0) > 0,
  text: "An agent with a model of its own can now have up to five fallback models, in order. When its model is at its provider's usage limit or fails to answer, the turn goes on with the first fallback that is free, then the next, and only after them the router's chain. Once its model's limit resets it answers again from the next turn, with no one doing anything. The reply's line shows which model answered and marks a fallback. The owner sets them in the agent's editor (Model and team), or asks you: agent_set takes fallbacks for an agent that has a model of its own. Offer to add fallbacks to the agents that run on a model of their own, from the models the owner has connected.",
  actions: [
    {
      label: { en: "Add fallbacks to my agents", es: "Agregar respaldos a mis agentes" },
      prompt:
        "Look at which of my agents run on a model of their own and suggest fallbacks for each from the models I have connected; set them once I say yes.",
    },
  ],
};
