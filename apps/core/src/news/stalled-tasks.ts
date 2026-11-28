import type { NewsEntry } from "./entries.ts";

export const STALLED_TASKS_NEWS: NewsEntry = {
  id: "stalled-tasks",
  since: "2.17.3",
  title: { en: "Let progressing tasks keep going", es: "Dejá que las tareas con avances sigan" },
  about: {
    en: "A task can start a new part without asking when its agent has made progress. You can adjust when stalled tasks pause separately from your budget.",
    es: "Una tarea puede empezar otro tramo sin preguntarte si su agente avanzó. Podés ajustar cuándo pausar tareas estancadas sin cambiar tu presupuesto.",
  },
  applies: (facts) => Boolean(facts.tasks),
  text: "Native task turns that hit the step cap can start another part in the same chat. Settings › Agents has separate stalled-task thresholds; zero for both turns and tokens disables this guard. Do not change limits unless asked, and do not confuse this with provider limits or approval scope.",
  actions: [
    {
      label: { en: "Review task limits", es: "Revisar límites de tareas" },
      prompt: "Explain the two kinds of agent limits and show me where to review them without changing anything.",
    },
  ],
};
