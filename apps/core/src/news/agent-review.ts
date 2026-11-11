import type { NewsEntry } from "./entries.ts";

export const AGENT_REVIEW_NEWS: NewsEntry = {
  id: "agent-review",
  since: "2.14.0",
  title: { en: "Review agents in their new context", es: "Revisá los agentes en su nuevo contexto" },
  about: {
    en: "Changed agents now leave a grouped review notice. Your super-agent can check copied instructions against their destination project and propose changes before applying them.",
    es: "Los agentes modificados dejan un aviso agrupado de revisión. Tu super-agente puede contrastar las instrucciones copiadas con el proyecto de destino y proponerte cambios antes de aplicarlos.",
  },
  applies: (facts) => (facts.promptedAgents ?? 0) > 0,
  text: "APX now includes apx-agents, the single guide for creating, editing, cloning, importing and reviewing agents. The previous apx-agent-prompts name still loads it. Internal changes and indexed external agent file edits leave grouped passive notices, without a model call per save. Offer to review a small batch in its destination context for stale project references, missing instructions and conflicting handoffs. Load apx-agents and use agent_set review:true to list pending reviews. Show before/after and ask before applying; use the reviewed revision so newer edits are not overwritten. An alert is not a diagnosis and never blocks work.",
  actions: [
    {
      label: { en: "Review changed agents", es: "Revisar agentes modificados" },
      prompt:
        "Review my changed agents in their destination context. Propose a small batch of changes with before/after, and do not edit anything until I choose what to apply.",
    },
  ],
};
