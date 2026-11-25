import type { NewsEntry } from "./entries.ts";

// Told to an owner whose projects APX moved from .apc/ to .agent/. See DECISIONS.md#d-275
export const AGENT_FOLDER_NEWS: NewsEntry = {
  id: "agent-folder",
  since: "2.17.0",
  title: { en: "Your projects' agents are now in .agent/", es: "Los agentes de tus proyectos ahora están en .agent/" },
  about: {
    en:
      "Projects keep their agents and settings in a folder named .agent/, next to AGENTS.md. APX moved yours from the " +
      "old .apc/ folder by itself; if a project is in git, the change shows as a diff for you to commit.",
    es:
      "Los proyectos guardan sus agentes y su configuración en una carpeta .agent/, al lado de AGENTS.md. APX movió " +
      "los tuyos desde la carpeta vieja .apc/ solo; si un proyecto está en git, el cambio aparece como diff para commitear.",
  },
  applies: (f) => f.agentFolder === true,
  text:
    "A project's own APX files (agents/<slug>.md, project.json, memory.md, skills, mcps.json, browser recipes) now " +
    "live in .agent/ at the project's root; AGENTS.md stays where it is. At start and when a project is registered, " +
    "APX moves a project's old .apc/ folder to .agent/ by itself: it copies every file, checks it arrived equal, " +
    "then removes .apc/ (git worktrees inside it stay), and the owner gets one notice per project in the tray. It " +
    "never commits: in a git repository the move is a diff the owner commits. A project it could not move keeps " +
    'working from .apc/, shows as "agents still in .apc/" in the projects list and on its page (with Try again), ' +
    "and is tried again at each start; apx doctor --fix retries all of them. Only the owner retries it. An APX v1 " +
    "still running reads .apc/ and no longer sees those agents.",
  actions: [
    {
      label: { en: "What changed?", es: "¿Qué cambió?" },
      prompt: "Which of my projects were moved from .apc/ to .agent/, and is any still left in .apc/?",
    },
  ],
};
