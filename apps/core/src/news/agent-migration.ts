import type { NewsEntry } from "./entries.ts";

export const AGENT_MIGRATION_NEWS: NewsEntry = {
  id: "agent-project-move",
  since: "2.16.0",
  title: { en: "Move an agent with its work", es: "Mové un agente con su trabajo" },
  about: {
    en: "Review and move an agent, its shared tasks and selected files into another project without making a copy.",
    es: "Revisá y trasladá un agente, sus tareas compartidas y los archivos que elijas a otro proyecto, sin crear una copia.",
  },
  applies: (facts) => (facts.promptedAgents ?? 0) > 0,
  text: "An existing project agent can now move to another existing project with its related work, including completed and shared tasks. Load apx-agents before preparing a move. Use agents.migration_preview through apx_settings to review the inventory, destination team, selected relative file paths and blockers. Moving preserves identity and instructions; it does not clone the agent. Review shared work and destination connections with the owner before calling agents.migrate. The move keeps a private recovery journal, pauses moved routines and retires saved grants. Historical copies in the owner's chats remain history; do not promise to erase every mention or revoke access outside APX. Offer to prepare a preview, never move automatically.",
  actions: [
    {
      label: { en: "Prepare an agent move", es: "Preparar el traslado de un agente" },
      prompt:
        "Help me choose an agent and destination project, then show me what would move and what would stay. Do not move anything until I confirm the preview.",
    },
  ],
};
