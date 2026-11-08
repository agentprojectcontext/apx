import type { NewsEntry } from "./entries.ts";

// Told once to an owner with a project: one team of agents can work across many subprojects.
export const SUBPROJECTS_NEWS: NewsEntry = {
  id: "subprojects",
  since: "2.14.0",
  title: {
    en: "Subprojects that share a team",
    es: "Subproyectos que comparten equipo",
  },
  about: {
    en:
      "A project, or the default one, can hold subprojects: each has its own folder, chats and memory, and the same " +
      "team of agents works in all of them. Any one can become a project apart later.",
    es:
      "Un proyecto, o el predeterminado, puede tener subproyectos: cada uno tiene su carpeta, sus chats y su memoria, " +
      "y el mismo equipo de agentes trabaja en todos. Cualquiera puede separarse en un proyecto aparte después.",
  },
  applies: (facts) => (facts.projects ?? 0) > 0,
  text:
    "A project can now have subprojects, one level deep, and so can the base project: projects.create with parent (a " +
    "project id, or ~default for the base project) makes one, in a folder inside its parent's unless a path is " +
    "given. A subproject works like any project (its own folder, AGENTS.md, chats, tasks, routines, apps and memory) " +
    "and also takes its parent's agents, variables, skills, MCP servers and apps; its own of the same name win, and " +
    "its memory is never its parent's. A parent's agent asked in a subproject works in the subproject's folder. " +
    "projects.update with parent moves an existing project under one, and parent null makes a subproject a project " +
    "apart again. Offer to group the owner's related work as subprojects of one project so they reuse one team; " +
    "create or move nothing until they say which.",
  actions: [
    {
      label: { en: "Group my projects", es: "Agrupar mis proyectos" },
      prompt:
        "Look at my projects and suggest which could be subprojects of one project (or of the default one) to share " +
        "a team of agents. Change nothing until I say so.",
    },
  ],
};
