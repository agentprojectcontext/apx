import type { NewsEntry } from "./entries.ts";

// Told first: tasks made before this release have no goal, so their agents are told to set one before working.
export const TASK_GOALS_NEWS: NewsEntry = {
  id: "task-goals",
  since: "2.13.0",
  title: { en: "Tasks with a goal and your own words", es: "Tareas con objetivo y tus propias palabras" },
  about: {
    en:
      "Each task now says where its work must arrive, keeps what you asked as you wrote it, and shows its agent's plan " +
      "step by step. Your open tasks were made before: your super-agent can bring them up to date.",
    es:
      "Cada tarea dice ahora adónde tiene que llegar su trabajo, guarda lo que pediste tal como lo escribiste y muestra " +
      "el plan de su agente paso a paso. Tus tareas abiertas son de antes: tu super-agente puede ponerlas al día.",
  },
  applies: (facts) => (facts.tasks ?? 0) > 0,
  text:
    "Tasks now carry a goal (where the work must arrive, the result the owner checks), the owner's own words as they " +
    "wrote them (kept by APX when an agent creates or changes a task while answering them), and a plan its agent keeps " +
    "as a checklist the owner sees step by step. The agent working a task reads the goal and the owner's words before " +
    "the brief, and the owner's words win where the brief drifted. An agent can no longer hand out a task without a " +
    "goal. The owner's open tasks were made before this: offer to bring them up to date. With task_list and task_get, " +
    "give each open task with an agent a goal from what the owner asked for it, and rewrite a description that is one " +
    "long paragraph as short Markdown lines, keeping every fact. Do not invent requirements, and say which tasks you " +
    "could not give a goal because what the owner wanted is unclear.",
  actions: [
    {
      label: { en: "Update my open tasks", es: "Poner al día mis tareas" },
      prompt:
        "Bring my open tasks up to date: give each one a goal from what I asked for it, tidy long descriptions into " +
        "short lines, and tell me what you set and which ones you could not.",
    },
  ],
};
