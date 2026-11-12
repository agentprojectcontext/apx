import type { NewsEntry } from "./entries.ts";

export const ROUTINE_PERMISSIONS_NEWS: NewsEntry = {
  id: "routine-permissions",
  since: "2.15.0",
  title: {
    en: "Routines work with their agent's full toolkit, on the permissions you pick",
    es: "Las rutinas trabajan con todas las herramientas de su agente, con los permisos que elijas",
  },
  about: {
    en: "A routine runs in a project and has what its agent has there, your Chrome included. Each routine has Permissions: as its agent, Manual, Auto or Total.",
    es: "Una rutina corre en un proyecto y tiene lo que su agente tiene ahí, tu Chrome incluido. Cada rutina tiene Permisos: como su agente, Manual, Auto o Total.",
  },
  applies: (facts) => (facts.routines ?? 0) > 0,
  text: "A routine now runs in a project the owner picks in its editor (picking a project's agent puts it there), and its runs have the same tools its agent has in a chat with the owner in that project: the project's MCP servers, skills, secrets and folder, and the owner's Chrome when it is connected. A routine saved with no project runs in the base project, without a project's own connections: a routine that used to say a tool was missing may only need its project. Each routine also has Permissions (routine_set autonomy: manual, auto, total, or agent for its agent's own): only that routine's runs act that way, nothing becomes a grant, and making one Total always waits for the owner's card. Offer to check which agent routines have no project and whether one should run on its own; never change one without the owner's word.",
  actions: [
    {
      label: { en: "Check my routines", es: "Revisar mis rutinas" },
      prompt:
        "List my agent routines with their project and permissions, and tell me which ones run with no project although their agent works in one. Do not change anything yet.",
    },
  ],
};
