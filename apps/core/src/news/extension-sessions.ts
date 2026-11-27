import type { NewsEntry } from "./entries.ts";

export const EXTENSION_SESSIONS_NEWS: NewsEntry = {
  id: "extension-sessions",
  since: "2.18.0",
  title: { en: "Disconnect without removing a connector", es: "Desconectá sin quitar un conector" },
  about: {
    en: "Supported Marketplace connections can forget their saved sign-in while staying installed. Turning one off keeps its sign-in for later; removing it uninstalls it.",
    es: "Las conexiones compatibles del Marketplace pueden olvidar el inicio de sesión guardado sin desinstalarse. Apagarlas conserva la sesión para después; quitarlas las desinstala.",
  },
  applies: (facts) => Boolean(facts.extensionSessions),
  text: "Marketplace extensions using a managed OAuth bridge now offer Disconnect separately from Turn off and Remove. Disconnect stops their MCP processes and clears only that extension's local bridge sessions. They stay installed and wait for an explicit sign-in; it does not revoke authorization at the provider. Turning off retains sessions. Do not offer sign-out for API-key-only or other unmanaged connections, infer an account from tokens, or call an idle server connected. Offer to explain these choices in Marketplace.",
  actions: [
    {
      label: { en: "Review my connections", es: "Revisar mis conexiones" },
      prompt:
        "Show me my Marketplace connections and explain which ones can disconnect, turn off or be removed. Don't change anything yet.",
    },
  ],
};
