// UI strings. English is the source; every key needs an English entry, other languages fall back to it.
export const en = {
  "notice.run.interrupted": "Interrupted by a restart of APX.",
  "notice.run.canceled": "Canceled.",
  "notice.run.failed": "Could not finish.",
  "notice.run.empty": "Finished without a message.",
  "notice.harness.fallback": "The chosen engine was not available; answered with the built-in model.",
} as const;

export type MessageKey = keyof typeof en;

export const es: Partial<Record<MessageKey, string>> = {
  "notice.run.interrupted": "Se interrumpió por un reinicio de APX.",
  "notice.run.canceled": "Cancelado.",
  "notice.run.failed": "No pude terminar.",
  "notice.run.empty": "Terminó sin mensaje.",
  "notice.harness.fallback": "El motor elegido no estaba disponible; respondió el modelo propio.",
};

export const LANGUAGES = { en, es } as const;
export type Language = keyof typeof LANGUAGES;
