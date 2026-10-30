import type { NewsEntry } from "./entries.ts";

export const BROWSER_JAVASCRIPT_NEWS: NewsEntry = {
  id: "approved-browser-javascript",
  since: "2.11.2",
  title: { en: "Approved scripts in your APX browser", es: "Scripts aprobados en tu navegador de APX" },
  about: {
    en:
      "Your agents can run a script in the APX browser tab, but only after you approve it on " +
      "the card they show. Read the code before you allow it.",
    es:
      "Tus agentes pueden ejecutar un script en la pestaña del navegador de APX, pero solo " +
      "después de que lo apruebes en la tarjeta que te muestran. Revisá el código antes de " +
      "permitirlo.",
  },
  applies: () => true,
  text: "Agents can run an inline JavaScript expression or an approved local .js file in their existing APX browser tab, without another browser or a remote debugging port. Execution requires an app approval even in Total, unless covered by an explicit temporary consent for this tab or current turn on the exact approved origin. Review code first: it can read private page data or send as your signed-in account. File hashes bind approval to exact bytes. Timeouts stop waiting, not side effects. A matching updated Desktop build is required when using embedded tabs.",
  actions: [
    {
      label: { en: "Try a read-only script", es: "Probar un script de lectura" },
      prompt:
        "Help me review a harmless script that returns the current APX browser tab title. Do not send anything or read credentials. Ask for approval before executing it.",
    },
  ],
};
