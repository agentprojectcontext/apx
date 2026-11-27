import type { NewsEntry } from "./entries.ts";

export const SERVER_BROWSER_CONTROL_NEWS: NewsEntry = {
  id: "server-browser-control",
  since: "2.18.0",
  title: {
    en: "Take over the server's browser from anywhere",
    es: "Tomá el navegador del servidor desde donde estés",
  },
  about: {
    en: "When APX runs on a server, you watch its browser tabs live from the app, the web panel or your phone, and take one over to click, type and sign in. The session stays there for your agents.",
    es: "Cuando APX corre en un servidor, mirás en vivo las pestañas de su navegador desde la app, el panel web o tu teléfono, y tomás una para hacer clic, escribir e iniciar sesión. La sesión queda ahí para tus agentes.",
  },
  applies: (facts) => Boolean(facts.devices),
  text:
    "On a core that browses with its own browser (a VPS or home server, no desktop app lending one), the owner now " +
    "sees each tab live in the Browser panel from any device: the desktop app connected by address, the web panel " +
    "or the phone. Take control lets them click, scroll and type in it (on a phone, tap where to type); Give back " +
    "returns it. While they hold it agents cannot act in or read the tab, and what they type never reaches an " +
    "agent. Sites they sign in to stay signed in on the server, so agents keep using them with the owner's " +
    "computer off. browser_handoff works there too: the owner finishes in the tab and presses Done.",
  actions: [
    {
      label: { en: "Sign in to a site there", es: "Iniciar sesión en un sitio ahí" },
      prompt: "Open the site I tell you in your browser and hand it to me so I can sign in there myself.",
    },
  ],
};
