import type { NewsEntry } from "./entries.ts";

export const CHANNEL_SERVICE_NEWS: NewsEntry = {
  id: "channel-service",
  since: "2.13.2",
  title: { en: "Choose how each channel serves customers", es: "Elegí cómo atiende cada canal" },
  about: {
    en: "Keep base attention, ask the super-agent to review tool operations, or let customers use the assigned agent's configured tools.",
    es: "Conservá la atención base, pedí al super-agente que revise cada operación o permití las herramientas configuradas del agente asignado.",
  },
  applies: (facts) => facts.channels > 0,
  text: "Each channel account has service_mode: base preserves current restrictions; review asks the super-agent before each tool operation; full exposes the assigned agent/project tools, including eligible MCP. Customers remain contacts. Existing accounts default to base. Review is operation-specific, not a chat-wide grant. Existing owner-only operations and confirmations remain. Offer to review the service agent's tools and data scope before enabling review or full; change a mode only on the owner's approved request.",
  actions: [
    {
      label: { en: "Review customer service", es: "Revisar la atención" },
      prompt:
        "Review my channel accounts and their assigned agents. Explain which tools customers could use in each service mode, and propose a suitable mode without changing anything yet.",
    },
  ],
};
