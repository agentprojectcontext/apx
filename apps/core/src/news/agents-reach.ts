import type { NewsEntry } from "./entries.ts";

// Told once to an owner with a teammate of the super-agent and a project to cross into: roles guide, never wall
// (DECISIONS.md#d-271).
export const AGENTS_REACH_NEWS: NewsEntry = {
  id: "agents-reach",
  since: "2.17.0",
  title: { en: "Your agents work across your projects", es: "Tus agentes trabajan en todos tus proyectos" },
  about: {
    en:
      "Your agents now read and work in all your projects and chats, and say where they acted. A role says what " +
      "each one is good at, not what it refuses. Your contacts' chats and what your mode leaves to you stay closed.",
    es:
      "Tus agentes ahora leen y trabajan en todos tus proyectos y chats, y dicen dónde actuaron. El rol dice en qué " +
      "es bueno cada uno, no qué rechaza. Los chats de tus contactos y lo que tu modo te deja a vos siguen cerrados.",
  },
  applies: (facts) => (facts.agents ?? 0) > 0 && (facts.projects ?? 0) > 0,
  text:
    "The owner's agents no longer stop at walls between one another's work. Working for the owner, any agent reads " +
    "any of the owner's chats, tasks, command outputs and project files, in every project, and acts where the work " +
    "is: it creates and updates tasks and widgets in another project and says which one. An agent's role, area " +
    "and tools: list are a hat, not a fence: tools: is what it uses first, the rest found with tool_search under " +
    "the same mode and rules; a rule the owner set to off still removes a tool. On a " +
    "task, progress lands on the plan's step instead of a comment, and the task's agent may ask a teammate mid-task, " +
    "recorded on the task. Code threads write in the owner's other projects in Auto like other chats. Still closed: " +
    "contacts' and rooms' chats, outside apps, APX's own folder, projects being moved, and what the owner's mode or " +
    "rules leave to them. Agents whose own instructions still say to refuse work outside their area may hold back: " +
    "offer to review those instructions (load_skill apx-agents) and change nothing until the owner says yes.",
  actions: [
    {
      label: { en: "Check my agents' instructions", es: "Revisar las instrucciones de mis agentes" },
      prompt:
        "Look at my agents' instructions and tell me which ones still tell them to refuse work outside their area or " +
        "project. Do not change anything until I say yes.",
    },
  ],
};
