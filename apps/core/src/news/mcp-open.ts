import type { NewsEntry } from "./entries.ts";

export const MCP_OPEN_NEWS: NewsEntry = {
  id: "mcp-open",
  since: "2.17.2",
  title: {
    en: "New MCP connections allow every tool",
    es: "Las conexiones MCP nuevas permiten todas sus tools",
  },
  about: {
    en: "A connection you add now lets your agents use all its tools, and you choose which ones ask first. Your agent can review them with you from the chat.",
    es: "Una conexión que agregues ahora deja que tus agentes usen todas sus tools, y vos elegís cuáles preguntan antes. Tu agente puede revisarlas con vos desde el chat.",
  },
  applies: (facts) => (facts.mcp ?? 0) > 0,
  text: "APX is now open by default: an MCP server the owner adds (in Resources, the CLI, an extension or by approving a project's file) lets every agent use all its tools, and the owner makes the ones they want ask first. Their existing servers kept what they had. You can review this for them: apx_settings mcp.list shows each server's tools as allowed or asking first, and mcp.toolMode sets mode all (every tool), all with ask: [tools] (all but those) or ask (none). Offer to review their servers once; change permissions only when they ask.",
  actions: [
    {
      label: { en: "Review my MCP permissions", es: "Revisar los permisos de mis MCP" },
      prompt:
        "Review my MCP connections: for each one, tell me which tools my agents use without asking and which ones ask first, and suggest what to allow. Do not change anything until I say.",
    },
  ],
};
