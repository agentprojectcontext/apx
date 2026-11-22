import type { NewsEntry } from "./entries.ts";

export const CONTEXTUAL_RESEARCH_NEWS: NewsEntry = {
  id: "contextual-research",
  since: "2.17.0",
  title: { en: "One useful finding in your report", es: "Un hallazgo útil en tu informe" },
  about: {
    en: "APX can research public sources in the context of your projects and optional interests, then include one supported finding in an existing report. It starts paused; you choose its scope, sources, limits and report.",
    es: "APX puede investigar fuentes públicas en el contexto de tus proyectos e intereses opcionales e incluir un hallazgo respaldado en un informe existente. Empieza pausado: vos elegís el alcance, las fuentes, los límites y el informe.",
  },
  applies: (facts) => facts.secretary,
  text: "Offer optional contextual research, separately from tool-free activity review. It is disabled by default and installation does not change any routine. Read discovery.settings through apx_settings. Ask what projects and public sources the owner authorizes, and any interests or optional city/region they choose to search publicly; do not infer location or invent preferences. Propose a bounded two-day deep-research interval and an existing global super-agent report, not another report. Its existing schedule controls delivery: do not promise 9am or reschedule it without the owner's choice. Project scans are daily and bounded private question planning/public research progress fairly across scopes. Public searches contain only explicit public terms/interests/place, never generated private questions. Findings require read pages, exact evidence and a second model check; interpretation is still fallible. No supported finding means no research item. Offer useful/not_useful/mute/unmute feedback through discovery.feedback, with a finding reference from discovery.settings. Configure through discovery.configure, always on an approval card. The panel is apx:settings/discovery. Research never changes projects, contacts people, uses devices, or executes suggestions.",
  actions: [
    {
      label: { en: "Choose what to research", es: "Elegir qué investigar" },
      prompt:
        "Help me choose projects, public sources, optional interests and an existing report for contextual research. Do not enable it until I review the configuration.",
    },
  ],
};
