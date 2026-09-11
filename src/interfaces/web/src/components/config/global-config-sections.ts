import type { ConfigSection } from "./ConfigTabsEditor";

// What ~/.apx/config.json holds that has nowhere better to live.
//
// It used to hold four tabs — Daemon, Super-agent, Telegram, Engines — and
// three of them were a worse copy of a screen in this same Settings: Engines &
// modelos owns the providers (per-provider base URL, key, active, delete),
// Super-agente owns its behaviour, Telegram owns its channels. Two editors for
// one setting is two answers to "where do I change this", and the loser is
// whichever one you did not open. The JSON tab is still there for everything
// this file can hold and no screen names.
export const GLOBAL_CONFIG_SECTIONS: ConfigSection[] = [
  {
    key: "daemon",
    label: "Daemon",
    description: "~/.apx/config.json. General APX config.",
    fields: [
      { path: "port", label: "Port", kind: "number", placeholder: "7430" },
      { path: "host", label: "Host", placeholder: "127.0.0.1" },
      { path: "log_level", label: "Log level", placeholder: "info" },
      // The three the AGENT reads (core/agent/prompt-builder.js), which is why
      // they sit next to the daemon's own settings rather than in Identidad:
      // what is written here wins over identity.json.
      //
      // And why each says so: a list of 41 languages under a bare "Language"
      // reads as the PANEL's language, which has exactly two (the ES/EN toggle
      // in the top bar, per device). This one is the ISO 639-1 code that goes
      // into the prompt as "Reply in the language with code X", so every
      // language the model speaks belongs in it.
      {
        path: "user.language",
        label: "Language",
        kind: "language",
        hint: "What the AGENT replies in (ISO 639-1). Not the panel's language — that is the ES/EN toggle up top.",
      },
      {
        path: "user.locale",
        label: "Locale",
        kind: "locale",
        placeholder: "es-AR",
        hint: "Dialect: es-AR voseás, es is neutral Spanish. Beats Language when both are set.",
      },
      {
        path: "user.timezone",
        label: "Timezone",
        kind: "timezone",
        placeholder: "America/Argentina/Buenos_Aires",
        hint: "Local time for schedules, routine headers and anything the agent dates.",
      },
    ],
  },
];
