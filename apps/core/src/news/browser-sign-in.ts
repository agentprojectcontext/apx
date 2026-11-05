import type { NewsEntry } from "./entries.ts";

export const BROWSER_SIGN_IN_NEWS: NewsEntry = {
  id: "browser-sign-in",
  since: "2.13.0",
  title: {
    en: "Agents sign in with your saved passwords, without seeing them",
    es: "Los agentes inician sesión con tus claves guardadas, sin verlas",
  },
  about: {
    en:
      "Save a password, username or authenticator key in Resources › Variables and choose the sites it is for. " +
      "Your agents fill it into the sign-in form in the APX browser and never see it.",
    es:
      "Guardá una contraseña, un usuario o una clave de autenticación en Recursos › Variables y elegí en qué " +
      "sitios sirve. Tus agentes la completan en el formulario de inicio de sesión del navegador de APX y nunca la ven.",
  },
  applies: (facts) => facts.desktop === true,
  text:
    "Agents can now sign in to websites with the owner's stored variables instead of handing the tab over: a " +
    "password, a username or an authenticator setup key (they fill the current code). The owner stores the value in " +
    "Resources, Variables, and lists the sites it is for, or any site; on another site the agent asks first, with " +
    "Once or Always on this site. The agent names the variable and the field; the browser fills it and the agent " +
    "gets only filled or refused, never the value. Card data is never filled.",
  actions: [
    {
      label: { en: "Set one up with me", es: "Configurarla conmigo" },
      prompt:
        "Walk me through saving the sign-in for one site I use in Variables and choosing that site, without me telling you the password.",
    },
  ],
};
