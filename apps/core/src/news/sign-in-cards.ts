import type { NewsEntry } from "./entries.ts";

export const SIGN_IN_CARDS_NEWS: NewsEntry = {
  id: "sign-in-cards",
  since: "2.17.0",
  title: {
    en: "Sign in without telling the agent which password",
    es: "Iniciá sesión sin decirle al agente qué clave usar",
  },
  about: {
    en: "At a login page your agent finds the username and password you saved for that site, or asks you to type them on a card it never sees, once or to keep.",
    es: "En una página de inicio de sesión tu agente busca el usuario y la contraseña que guardaste para ese sitio, o te pide escribirlos en una tarjeta que no ve, para una vez o para guardar.",
  },
  applies: () => true,
  text: "browser_sign_in no longer needs a variable's name. At a sign-in form, call it without secret: APX uses the owner's variable set for that site, offers one named after the site on a card, or asks the owner to type a username and password on a card the agent never sees, to use once or to save as a variable for the site. Variables can now be of type username and password (both in one variable, each filled into its own field), and the Variables list shows each variable's type. Offer to save a sign-in for a site the owner uses often. Never ask for passwords in chat, and never claim a sign-in was saved unless the tool said so.",
  actions: [
    {
      label: { en: "Save a sign-in", es: "Guardar un acceso" },
      prompt: "Help me save a username and password for a site I use, so you can sign in there without asking.",
    },
  ],
};
