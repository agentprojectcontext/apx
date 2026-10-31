import type { NewsEntry } from "./entries.ts";

export const BROWSER_EDIT_NEWS: NewsEntry = {
  id: "browser-edit-panel",
  since: "2.13.0",
  title: { en: "Point at what to change in a page", es: "Señalá qué cambiar en una página" },
  about: {
    en:
      "When an agent makes a site or a widget, press Edit in the APX browser or the pencil on the widget, click the " +
      "part you want different and change its text or look. You see it right away, then ask the agent for it.",
    es:
      "Cuando un agente hace un sitio o un widget, apretá Editar en el navegador de APX o el lápiz del widget, hacé " +
      "clic en la parte que querés distinta y cambiá su texto o su estilo. Lo ves al instante y después se lo pedís al agente.",
  },
  applies: () => true,
  text: "The owner can now press Edit in the APX browser panel on a page an agent made (a local site or landing), click parts of it and change their text, colors, font size and spacing, seen live only in their view, plus a note in words. Widgets work the same from the pencil in the Widget panel (the widget runs apart, offline, in APX's own browser). Ask puts the changes in the chat's message box as quoted lines with the page, each part's words and a CSS selector to find it in the code; the owner sends it. For a widget the request names it as «title» (name): update it with the same name. Offer it when you have just built or changed a web page or widget for them.",
  actions: [
    {
      label: { en: "Make a page to try it", es: "Hacer una página para probarlo" },
      prompt:
        "Make me a small one-page landing for a made-up café, serve it locally and open it in the APX browser so I can try Edit on it.",
    },
  ],
};
