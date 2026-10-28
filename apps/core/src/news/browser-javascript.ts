import type { NewsEntry } from "./entries.ts";

export const BROWSER_JAVASCRIPT_NEWS: NewsEntry = {
  id: "approved-browser-javascript",
  since: "2.11.2",
  title: "Approved scripts in your APX browser",
  applies: () => true,
  text: "Agents can run an inline JavaScript expression or an approved local .js file in their existing APX browser tab, without another browser or a remote debugging port. Every execution keeps an approval card even in Total. Review code first: it can read private page data or send as your signed-in account. File hashes bind approval to exact bytes. Timeouts stop waiting, not side effects. A matching updated Desktop build is required when using embedded tabs.",
  actions: [
    {
      label: { en: "Try a read-only script", es: "Probar un script de lectura" },
      prompt:
        "Help me review a harmless script that returns the current APX browser tab title. Do not send anything or read credentials. Ask for approval before executing it.",
    },
  ],
};
