import type { NewsEntry } from "./entries.ts";

export const TASK_REGROUP_NEWS: NewsEntry = {
  id: "task-regroup",
  since: "2.13.0",
  title: { en: "Group related tasks", es: "Agrupá tareas relacionadas" },
  about: {
    en: "Ask your agent to put existing tasks under one parent, keeping their history and the people working on them.",
    es: "Pedile a tu agente que ponga tareas existentes bajo una tarea madre, conservando su historial y responsables.",
  },
  applies: (facts) => (facts.tasks ?? 0) > 1,
  text: "Existing tasks can now be regrouped with task_update parent (a task ID, or null to detach). Keep related work in the same project; do not recreate tasks or restart their work. Offer to inspect related tasks and group only those belonging to one goal, keeping unrelated work separate.",
  actions: [
    {
      label: { en: "Review my task groups", es: "Revisar mis grupos de tareas" },
      prompt:
        "Review my existing tasks and group those that belong under the same goal, preserving their history and keeping unrelated work separate.",
    },
  ],
};
