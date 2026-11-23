import type { NewsEntry } from "./entries.ts";

export const BROWSER_RECIPES_NEWS: NewsEntry = {
  id: "browser-recipes",
  since: "2.17.0",
  title: {
    en: "Agents repeat browser work from a saved recipe",
    es: "Los agentes repiten trabajo en el navegador con una receta guardada",
  },
  about: {
    en:
      "When an agent does the same thing on a website many times, like scheduling a month of posts, it learns the " +
      "steps once, saves them as a recipe of the project and runs it again with new values: faster, and far fewer tokens.",
    es:
      "Cuando un agente hace lo mismo muchas veces en un sitio, como programar un mes de posts, aprende los pasos " +
      "una vez, los guarda como receta del proyecto y la vuelve a correr con valores nuevos: más rápido y con muchos menos tokens.",
  },
  applies: () => true,
  text:
    "Agents can now send a whole browser sequence in one call (browser_do: open, click, type, wait, naming buttons " +
    "as the page shows them) instead of reading the page between clicks. Once it works, they save it as a recipe of " +
    "the project, with blanks for what changes (the text, the date), and a memory note so they find it again; next " +
    "time it is one short call per item. Recipes are a list of steps in the project's .apc folder, never code, and " +
    "follow the same browser rules. Also new: a task an agent creates or hands on while working for the owner may use " +
    "the owner's Chrome, as the owner's own tasks do.",
  actions: [
    {
      label: { en: "What could I repeat?", es: "¿Qué podría repetir?" },
      prompt:
        "Tell me in a few lines how a browser recipe works and suggest one job I do on a website often that you could learn once and repeat.",
    },
  ],
};
