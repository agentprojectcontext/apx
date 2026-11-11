import type { NewsEntry } from "./entries.ts";

export const MCP_REACH_NEWS: NewsEntry = {
  id: "mcp-reach",
  since: "2.13.5",
  title: {
    en: "Move an MCP into a project, and keep “All allowed” for new tools",
    es: "Mové un MCP a un proyecto, y “Todas permitidas” sigue con tools nuevas",
  },
  about: {
    en: "A connection can live globally or in one project, and a global one shows the projects it is on in. All allowed now covers tools a server adds later.",
    es: "Una conexión puede vivir global o en un proyecto, y una global muestra en qué proyectos está prendida. Todas permitidas ahora cubre las tools que el servidor agregue después.",
  },
  applies: (facts) => (facts.mcp ?? 0) > 0,
  text: "In Resources › MCP, the connection editor has Lives in (Global or one project: only that project's agents use it) and, for a global one, Available in (all projects or some). The list says In N of M instead of Global while it is off somewhere, and shows each server's tools and permission state from the last time it ran, before opening it. All allowed is now one setting for the server: tools it adds later are allowed too; picking tools one by one is Some, and new ones ask. Servers the owner had allowed tool by tool now read Some: offer to look at them and set All allowed again where the owner wants it. Never change a permission without the owner's word.",
  actions: [
    {
      label: { en: "Review MCP permissions", es: "Revisar permisos de MCP" },
      prompt:
        "List my MCP connections with where each lives, the projects it is on in and its tool permissions, and tell me which ones read Some although every tool is allowed. Do not change anything yet.",
    },
  ],
};
