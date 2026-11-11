import type { NewsEntry } from "./entries.ts";

// Prompts written before 2.14 may gate work APX now settles itself: the super-agent offers to review them.
export const AGENT_PROMPTS_NEWS: NewsEntry = {
  id: "agent-prompts",
  since: "2.14.0",
  title: { en: "Agents finish and publish their tasks", es: "Los agentes terminan y publican sus tareas" },
  about: {
    en:
      "The agent on a task now carries it to the end, publishing included when you ask for it, and reviewers report " +
      "instead of blocking. Your super-agent can check your agents' instructions for lines that still hold work back.",
    es:
      "El agente de una tarea ahora la lleva hasta el final, publicación incluida cuando la pedís, y quienes revisan " +
      "informan en vez de frenar. Tu super-agente puede revisar las instrucciones de tus agentes por si alguna todavía " +
      "frena el trabajo.",
  },
  applies: (facts) => (facts.promptedAgents ?? 0) > 0,
  text:
    "The agent on a task now owns it until it is delivered: publishing what can be undone is part of the work, and a " +
    "release, a payment or a message as the owner waits for them. Reviews report and never block; whoever gave the " +
    "task checks the delivery and tells the owner. APX tells each agent whom it answers to and its area. The owner's " +
    "agents may have instructions that still gate this (people named as bosses, 'do not push unless authorized', " +
    "mandatory approvals). Offer to review them: load_skill apx-agents and follow it. Change nothing until " +
    "the owner says yes to each agent's change.",
  actions: [
    {
      label: { en: "Review my agents' instructions", es: "Revisar las instrucciones de mis agentes" },
      prompt:
        "Review my agents' instructions for lines that hold work back and tell me what you would change in each. " +
        "Do not change anything until I say yes.",
    },
  ],
};
