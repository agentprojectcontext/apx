import type { NewsEntry } from "./entries.ts";

export const HERMES_IMPORT_NEWS: NewsEntry = {
  id: "import-hermes",
  since: "2.13.0",
  title: { en: "Bring your Hermes setup", es: "Traé tu configuración de Hermes" },
  about: {
    en: "Your Hermes agents, memory, skills, scheduled jobs and MCP servers can come to APX. You see what comes first; secrets never do.",
    es: "Tus agentes, memoria, skills, tareas programadas y servidores MCP de Hermes pueden venir a APX. Primero ves qué viene; los secretos nunca.",
  },
  applies: (facts) => Boolean(facts.hermes),
  text: "The owner has a Hermes home folder (~/.hermes). Offer to bring it: `apx import hermes ~/.hermes` lists what would come (each profile an agent, its memory as notes, skills, cron jobs as routines turned off, MCP servers); tell the owner in a few words, and only on their yes import it (hermes.import through apx_settings, or the same command with --yes). Secrets are never copied: servers that need one come off until the owner gives it in APX.",
  actions: [
    {
      label: { en: "See what would come", es: "Ver qué vendría" },
      prompt: "Show me what importing my Hermes setup would bring, without importing anything yet.",
    },
  ],
};
