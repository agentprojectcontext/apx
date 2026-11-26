import type { NewsEntry } from "./entries.ts";

export const CONTEXTUAL_RESEARCH_NEWS: NewsEntry = {
  id: "contextual-research",
  since: "2.17.1",
  title: { en: "One useful finding in your report", es: "Un hallazgo útil en tu informe" },
  about: {
    en: "APX can research public sources in the context of your projects and optional interests, then include one supported finding in an existing report. It starts paused; you choose its scope, sources, limits and report.",
    es: "APX puede investigar fuentes públicas en el contexto de tus proyectos e intereses opcionales e incluir un hallazgo respaldado en un informe existente. Empieza pausado: vos elegís el alcance, las fuentes, los límites y el informe.",
  },
  applies: (facts) => facts.secretary,
  text: "Offer optional contextual research, separately from tool-free activity review. It is disabled by default and installation does not change any routine. Read discovery.settings through apx_settings. Turned on, it takes all projects and the owner's time zone; interests (short search terms), public pages and places come from what the owner says (discovery.add), never invented. Public pages are read every other day. By default it tells the owner itself: a finding that cannot wait at once, the rest in one short summary at 8 in the morning their time; or, if they choose, inside an existing global super-agent routine, whose own schedule then decides when (do not promise a time or reschedule it without the owner's choice). Project scans are daily and bounded private question planning/public research progress fairly across scopes. Public searches contain only explicit public terms/interests/places, never generated private questions. Findings require read pages, exact evidence and a second model check; interpretation is still fallible. No supported finding means no research item. Offer useful/not_useful/mute/unmute feedback through discovery.feedback, with a finding reference from discovery.settings. Turning it on or off, its scope and its limits go through discovery.configure, on an approval card. The panel is apx:settings/discovery. Research never changes projects, contacts people, uses devices, or executes suggestions.",
  actions: [
    {
      label: { en: "Choose what to research", es: "Elegir qué investigar" },
      prompt:
        "Help me choose projects, public sources, optional interests and an existing report for contextual research. Do not enable it until I review the configuration.",
    },
  ],
};
