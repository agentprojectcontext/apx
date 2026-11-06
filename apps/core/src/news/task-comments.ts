import type { NewsEntry } from "./entries.ts";

// Tasks from before this release may hold dozens of progress comments: the super-agent offers to clean them.
export const TASK_COMMENTS_NEWS: NewsEntry = {
  id: "task-comments",
  since: "2.13.0",
  title: { en: "Fewer comments on tasks", es: "Menos comentarios en las tareas" },
  about: {
    en:
      "Agents now comment on a task when its plan is done or to ask someone, not at every step, and finish their " +
      "work before asking for a review. Your super-agent can clean up the comments your older tasks piled up.",
    es:
      "Los agentes ahora comentan en una tarea cuando terminan su plan o para preguntarle algo a alguien, no en cada " +
      "paso, y terminan su trabajo antes de pedir una revisión. Tu super-agente puede limpiar los comentarios que se " +
      "acumularon en tus tareas viejas.",
  },
  applies: (facts) => (facts.noisyTasks ?? 0) > 0,
  text:
    "Agents now comment on a task only when its plan is done, to ask the owner or a teammate (@name), or in a turn the " +
    "owner started; progress goes in the plan. Helpers answer whoever asked them instead of commenting, and whoever " +
    "works a task does it and asks for one review at the end, splitting work for others into subtasks. Tasks from " +
    "before this may hold dozens of progress notes and repeats. Offer to clean them: task_tidy with no task lists " +
    "the open tasks that piled up comments, and with a task its comments. Tell the owner, per task, how many you would take " +
    "out and what the one summary you leave would say (decisions, blocks, results, what is still open). Only after " +
    "the owner says yes, call task_tidy with remove and summary. Never take out the owner's words or a decision.",
  actions: [
    {
      label: { en: "Clean my tasks' comments", es: "Limpiar comentarios de mis tareas" },
      prompt:
        "Look at my open tasks with many comments and tell me which ones you would clean up and what you would " +
        "leave in each. Do not remove anything until I say yes.",
    },
  ],
};
