import type { NewsEntry } from "./entries.ts";

export const MCP_CONTEXT_NEWS: NewsEntry = {
  id: "mcp-context",
  since: "2.13.4",
  title: { en: "Edit connections without leaving the chat", es: "Editá conexiones sin salir del chat" },
  about: {
    en: "Open an MCP connection from a chat link, choose its variables by name and decide which project can use it.",
    es: "Abrí una conexión MCP desde un enlace del chat, elegí sus variables por nombre y decidí qué proyecto puede usarla.",
  },
  applies: (facts) => (facts.mcp ?? 0) > 0,
  text: "MCP links can now open the connection editor over the current chat. Link apx:resources/mcp/NAME/global for an owner's private server, including one limited to a project, or apx:resources/mcp/NAME/PROJECT_ID for a repository definition. Private connections have Available in: all projects or one project, without copying their secrets into the repository. Environment and header fields have a visible variable picker, also opened with Ctrl+Space. It lists the selected project's effective variable names, including overrides, never values. Offer to inspect the owner's connections and help limit one to the right project; never assume similarly named variables have equal values.",
  actions: [
    {
      label: { en: "Review my connections", es: "Revisar mis conexiones" },
      prompt:
        "Review my MCP connections, check their variable references and show me links to edit the ones that need attention without leaving this chat. Do not remove variables or change accounts without checking.",
    },
  ],
};
