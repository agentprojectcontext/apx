import type { NewsEntry } from "./entries.ts";

export const BROWSER_EDIT_NEWS: NewsEntry = {
  id: "browser-edit-panel",
  since: "2.13.0",
  title: { en: "Point at what to change in a page", es: "Señalá qué cambiar en una página" },
  about: {
    en:
      "When an agent makes a site, a web page or a widget, press Edit, click the part you want different and change " +
      "its text or look. You see it right away; on a page or widget, Save keeps it with no agent in between.",
    es:
      "Cuando un agente hace un sitio, una página web o un widget, apretá Editar, hacé clic en la parte que querés " +
      "distinta y cambiá su texto o su estilo. Lo ves al instante; en una página o un widget, Guardar lo deja sin pasar por el agente.",
  },
  applies: () => true,
  text: 'The owner can now press Edit on a page an agent made, one part at a time: in the APX browser panel (a local site or landing) or on a widget. A web page asked for in chat is made with show_widget page: true and shows in a page frame with Edit. In a widget or page, text, colors, font size and spacing are saved straight into its HTML as a new version; only what the owner writes in "Anything else?" (or a part the page\'s code draws at run time) reaches you, as a plain request in the message box: the page, then each part by its words. Read the widget again before editing it. Offer it when you have just built a web page or widget for them.',
  actions: [
    {
      label: { en: "Make a page to try it", es: "Hacer una página para probarlo" },
      prompt: "Make me a small web page for a made-up café so I can try Edit on it.",
    },
  ],
};
