import type { enTelemetry } from "./en-telemetry.ts";

export const esTelemetry: Record<keyof typeof enTelemetry, string> = {
  "telemetry.check": "Compartir estadísticas de uso anónimas",
  "telemetry.checkHint":
    "Las estadísticas de uso anónimas nos muestran cómo se usa APX de verdad, para saber qué mejorar primero. Nunca miramos tus chats, archivos ni datos personales.",
  "telemetry.cardTitle": "Ayudá a mejorar APX",
  "telemetry.cardYes": "Compartir estadísticas",
  "telemetry.cardNo": "No, gracias",
  "telemetry.whatIsSent": "Qué se envía",
};
