import type { NewsEntry } from "./entries.ts";

export const EXTENSION_EVENTS_NEWS: NewsEntry = {
  id: "extension-observations",
  since: "2.16.1",
  title: {
    en: "Let an extension tell your agent when something changes",
    es: "Dejá que una extensión le avise a tu agente cuando algo cambia",
  },
  about: {
    en: "Extensions that support notices can check in the background and wake your chosen agent when something changes. Choose a personal chat and quiet hours in the extension's settings. Connecting alone does not turn notices on.",
    es: "Las extensiones que admiten avisos pueden consultar en segundo plano y despertar al agente elegido cuando algo cambia. Elegí una charla personal y horarios de silencio en su configuración. Conectarlas no activa los avisos.",
  },
  applies: (facts) => Boolean(facts.extensionEvents),
  text: "An installed extension declares observations. Offer to configure its notices through apx_settings extensions.events_get and extensions.events_set, choosing a personal chat and quiet hours with the owner. Connecting alone never opts in. The core polls only its declared MCP observation tool, without a model turn per check. It persists and deduplicates stable event ids and queues them as outside data. Turning the extension off revokes notices; reconnecting alone does not resume them. Controls are separate explicit actions, never consequences of an event. Do not promise that a cloud reading proves physical completion. Gmail keeps its existing delivery with no second copy.",
  actions: [
    {
      label: { en: "Choose notices", es: "Elegir avisos" },
      prompt:
        "Show me which installed extensions support notices and help me choose a personal chat and quiet hours. Don't activate them until I choose.",
    },
  ],
};
