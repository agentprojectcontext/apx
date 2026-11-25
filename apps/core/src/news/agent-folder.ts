import type { NewsEntry } from "./entries.ts";

// Told while a project still keeps its agents in .apc/, the folder earlier versions used. See DECISIONS.md#d-273
export const AGENT_FOLDER_NEWS: NewsEntry = {
  id: "agent-folder",
  since: "2.17.0",
  title: { en: "Move your projects' agents to .agent/", es: "Mové los agentes de tus proyectos a .agent/" },
  about: {
    en:
      "Projects now keep their agents and settings in a folder named .agent/, next to AGENTS.md. Some of yours still " +
      "use the old .apc/ folder: move them once from the project's page or with apx doctor --fix.",
    es:
      "Los proyectos ahora guardan sus agentes y su configuración en una carpeta .agent/, al lado de AGENTS.md. " +
      "Algunos tuyos todavía usan la carpeta vieja .apc/: movelos una vez desde la página del proyecto o con apx doctor --fix.",
  },
  applies: (f) => (f.legacyFolders ?? 0) > 0,
  text:
    "A project's own APX files (agents/<slug>.md, project.json, memory.md, skills, mcps.json, browser recipes) now " +
    "live in .agent/ at the project's root; AGENTS.md stays where it is. Some of this owner's projects still have " +
    "them in .apc/, the old name: APX keeps those projects' agents as they were last read, but reads no change " +
    "there and refuses new writes until they move. Moving copies every file to .agent/, checks it arrived equal, " +
    "then removes it from .apc/; git worktrees inside .apc/ stay. Only the owner moves them: Move on the project's " +
    "page, or apx doctor --fix in a terminal for all of them. Tell the owner which projects (the projects list marks them " +
    "\"agents still in .apc/\") and where to press; an APX v1 still running reads .apc/ and stops seeing those agents.",
  actions: [
    {
      label: { en: "Which projects?", es: "¿Qué proyectos?" },
      prompt: "Which of my projects still keep their agents in .apc/, and how do I move them to .agent/?",
    },
  ],
};
