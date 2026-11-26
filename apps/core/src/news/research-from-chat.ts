import type { NewsEntry } from "./entries.ts";

export const RESEARCH_FROM_CHAT_NEWS: NewsEntry = {
  id: "research-from-chat",
  since: "2.17.2",
  title: { en: "Your research fills in as you chat", es: "La investigación se completa mientras charlan" },
  about: {
    en: "Mention what you care about while you chat, and APX adds interests, projects and places to your research by itself.",
    es: "Contá lo que te interesa mientras charlan y APX suma intereses, proyectos y lugares a tu investigación por su cuenta.",
  },
  applies: (facts) => facts.secretary && facts.research === true,
  text: "Contextual research now fills itself from conversation. When the owner mentions an interest, a project to follow, an official public page or their city or region, add it with apx_settings discovery.add without announcing it; the chat shows a small chip they can open. Turning research on already chose all their projects, their time zone and their daily report. Offer once to fill it now from what you already know about them.",
  actions: [
    {
      label: { en: "Fill in my research", es: "Cargar mi información para la investigación" },
      prompt:
        "Fill in my research with what you already know about me: interests, projects to follow, official pages and my city or region. Ask me at most one question if something important is missing; otherwise just do it.",
    },
  ],
};
