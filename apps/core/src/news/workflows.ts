import type { NewsEntry } from "./entries.ts";

// Told once to an owner with a teammate for the super-agent to fan work out to (DECISIONS.md#d-273).
export const WORKFLOWS_NEWS: NewsEntry = {
  id: "workflows",
  since: "2.17.0",
  title: { en: "Big jobs run as workflows", es: "Los trabajos grandes corren como flujos de trabajo" },
  about: {
    en:
      "For a big job your agent can now run a workflow: several agents at once, each result checked before it goes " +
      "on, on one card that shows every agent's progress. You can stop it and resume it later; what is done is kept.",
    es:
      "Para un trabajo grande tu agente ahora puede correr un flujo de trabajo: varios agentes a la vez, cada " +
      "resultado revisado antes de seguir, en una tarjeta que muestra el avance de cada uno. Podés detenerlo y " +
      "reanudarlo después; lo hecho se conserva.",
  },
  applies: (facts) => (facts.agents ?? 0) > 0,
  text:
    "Work too wide for one agent (auditing many areas, checking many files, researching many options) can run as a " +
    "workflow (tool `workflow`, found with tool_search): a plan of items that each go through up to four stages, up " +
    "to four agents at once, with a JSON schema per stage when the next one needs structured data, `only_if` to " +
    "drop what a check rejects, and a finish stage that writes the result. The chat shows one card with each agent's " +
    "state; the owner can stop it and resume it, and done steps are kept. Every agent in it keeps the owner's mode, " +
    "rules and budgets, as a delegation does. Offer it the next time the owner asks for something that fans out.",
  actions: [
    {
      label: { en: "Show me with a real job", es: "Mostrame con un trabajo real" },
      prompt:
        "Show me a workflow on something real: pick a project of mine, list its main areas, and have an agent review " +
        "each area in parallel and a second one check what it finds. Tell me the plan before you start it.",
    },
  ],
};
