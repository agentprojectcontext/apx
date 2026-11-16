import type { CatalogEngine, ModelAnnouncement } from "@apx/protocol";

type Launch = Omit<ModelAnnouncement, "engines" | "destination">;
const google = "https://blog.google/innovation-and-ai/models-and-research/gemini-models/";

const LAUNCHES: readonly Launch[] = [
  {
    id: "gemini-4-hydrogen-2026-11-12",
    model: "gemini-4-hydrogen",
    name: "Gemini 4 Hydrogen",
    date: "2026-11-12",
    source: `${google}introducing-gemini-4-hydrogen/`,
    integration: "pending",
    summary: {
      en: "Google's new model for everyday coding and agent workflows.",
      es: "El nuevo modelo de Google para programación diaria y tareas con agentes.",
    },
    access: {
      en: "Google offers it across Gemini API tiers.",
      es: "Google lo ofrece en los niveles de la API de Gemini.",
    },
  },
  {
    id: "gemini-4-carbon-2026-11-10",
    model: "gemini-4-carbon",
    name: "Gemini 4 Carbon",
    date: "2026-11-10",
    source: `${google}gemini-4-carbon-now-available/`,
    integration: "pending",
    summary: {
      en: "Google's new model for complex coding and extended reasoning.",
      es: "El nuevo modelo de Google para programación compleja y razonamiento prolongado.",
    },
    access: { en: "Google requires paid API access.", es: "Google requiere acceso pago a la API." },
  },
  {
    id: "claude-fable-5-2-2026-11-09",
    model: "claude-fable-5-2",
    name: "Claude Fable 5.2",
    date: "2026-11-09",
    source: "https://platform.claude.com/docs/en/release-notes/overview#november-9-2026",
    integration: "pending",
    summary: {
      en: "Anthropic's new model for demanding reasoning and long-running agent work.",
      es: "El nuevo modelo de Anthropic para razonamiento exigente y tareas largas con agentes.",
    },
    access: {
      en: "Requires 30-day data retention.",
      es: "Requiere retención de datos de 30 días.",
    },
  },
  {
    id: "gpt-6-1-terra-2026-10-26",
    model: "gpt-6.1-terra",
    name: "GPT-6.1 Terra",
    date: "2026-10-26",
    source: "https://developers.openai.com/api/docs/changelog#october-2026",
    integration: "pending",
    summary: {
      en: "OpenAI's new model for visual reasoning, computer use and writing.",
      es: "El nuevo modelo de OpenAI para razonamiento visual, uso de la computadora y escritura.",
    },
    access: {
      en: "Review your OpenAI API access and limits.",
      es: "Revisá tu acceso y los límites de la API de OpenAI.",
    },
  },
  {
    id: "gemini-4-argon-2026-10-13",
    model: "gemini-4-argon",
    name: "Gemini 4 Argon",
    date: "2026-10-13",
    source: `${google}introducing-gemini-4-argon/`,
    integration: "pending",
    summary: {
      en: "Google's model for complex coding and knowledge work.",
      es: "El modelo de Google para programación compleja y trabajo con documentos.",
    },
    access: {
      en: "Google offers developer access through its API.",
      es: "Google ofrece acceso para desarrolladores por su API.",
    },
  },
];

/** A fresh list establishes relevance, not successful inference or account entitlement. */
export function modelAnnouncements(engines: readonly CatalogEngine[]): ModelAnnouncement[] {
  return LAUNCHES.flatMap((launch) => {
    const matching = engines.filter(
      (engine) => engine.available && !engine.detail && engine.models.some((m) => m.chat && m.id === launch.model),
    );
    if (!matching.length) return [];
    const api = matching.some((engine) => engine.kind === "provider");
    return [
      {
        ...launch,
        engines: matching.map((e) => e.id),
        destination: api ? "models" : "sessions",
        access: api
          ? launch.access
          : {
              en: "Check the models included in your external session's plan.",
              es: "Revisá los modelos incluidos en el plan de tu sesión externa.",
            },
      },
    ];
  });
}
