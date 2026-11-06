import type { NewsEntry } from "./entries.ts";

export const CHROME_TABS_NEWS: NewsEntry = {
  id: "chrome-tabs",
  since: "2.13.0",
  title: { en: "Agents can work in your Chrome", es: "Los agentes pueden trabajar en tu Chrome" },
  about: {
    en: "Write to an agent from APX's side panel in Chrome and it works in your own Chrome, where you are already signed in, in a tab group called APX that you can watch.",
    es: "Escribile a un agente desde el panel lateral de APX en Chrome y trabaja en tu propio Chrome, donde ya iniciaste sesión, en un grupo de pestañas llamado APX que podés mirar.",
  },
  applies: () => process.platform !== "win32",
  text:
    "With APX's Chrome extension (Chrome Web Store, then open it from Chrome's toolbar), what the owner writes in " +
    "its side panel makes the agent browse in the owner's own Chrome instead of APX's browser: tabs in an orange " +
    "group called APX, where the owner is signed in and watches. Agents see only that group; the owner shares an " +
    "open tab by dragging it in, and Cancel on Chrome's bar stops APX in a tab. From the app, the phone or a " +
    "channel the owner can also ask for their Chrome (browser_open with chrome); otherwise APX's browser is used. Agents never type passwords or card details there: the owner signs " +
    "in. APX must be running on the same computer; it works on macOS and Linux.",
  actions: [
    {
      label: { en: "How do I set it up?", es: "¿Cómo lo configuro?" },
      prompt:
        "Tell me in a few lines how I install APX's Chrome extension and what I can ask you to do in my Chrome " +
        "from its side panel.",
    },
  ],
};
