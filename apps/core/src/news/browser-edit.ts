import type { NewsEntry } from "./entries.ts";

export const BROWSER_EDIT_NEWS: NewsEntry = {
  id: "browser-edit-panel",
  since: "2.13.0",
  title: { en: "Point at what to change in a page", es: "Señalá qué cambiar en una página" },
  about: {
    en:
      "Ask an agent for a web page and it shows as one: see its code, open it on its own screen at a computer's or a " +
      "phone's width, press Edit, click the part you want different and change its text or look. Save keeps it with " +
      "no agent in between. Edit works on a site in APX's browser and on widgets too.",
    es:
      "Pedile a un agente una página web y se ve como tal: mirá su código, abrila en su propia pantalla al ancho de " +
      "una compu o de un teléfono, apretá Editar, hacé clic en la parte que querés distinta y cambiá su texto o su " +
      "estilo. Guardar lo deja sin pasar por el agente. Editar también anda en un sitio del navegador de APX y en los widgets.",
  },
  applies: () => true,
  text: 'The owner can now press Edit on a page an agent made, one part at a time: in the APX browser panel (a local site or landing), on a widget, or on a web page. A web page asked for in chat is made with show_widget page: true, as a whole document with its own styles (no kit); it shows like an HTML block with its code, opens on its own screen at desktop or phone width, and is edited there. In a widget or page, text, colors, font size and spacing are saved straight into its HTML as a new version; only what the owner writes in "Anything else?" (or a part the page\'s code draws at run time) reaches you, as a plain request in the message box: the page, then each part by its words. Read the widget again before editing it. Offer it when you have just built a web page or widget for them.',
  actions: [
    {
      label: { en: "Make a page to try it", es: "Hacer una página para probarlo" },
      prompt: "Make me a small web page for a made-up café so I can try Edit on it.",
    },
  ],
};
