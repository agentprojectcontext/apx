import type { MessageKey } from "./en.ts";

// Telemetría: el checkbox del setup, la tarjeta que le pregunta una vez a una instalación anterior y su parte de Avanzado.
export const esTelemetry: Partial<Record<MessageKey, string>> = {
  "telemetry.check": "Compartir estadísticas de uso anónimas",
  "telemetry.checkHint":
    "Una vez por día: los tokens usados y cuántos proyectos, agentes y canales tenés. Nunca tus chats, nombres ni archivos.",
  "telemetry.cardTitle": "Ayudá a mejorar APX",
  "telemetry.cardYes": "Compartir estadísticas",
  "telemetry.cardNo": "No, gracias",
  "telemetry.whatIsSent": "Qué se envía",
  "telemetry.title": "Estadísticas de uso",
  "telemetry.lead":
    "Un id al azar, no ligado a vos, le avisa al proyecto APX cuándo se configuró esta instalación, cuándo se usó por primera vez y cuándo se actualizó. Si decís que sí, además manda una vez por día los números de abajo.",
  "telemetry.off": "La telemetría está apagada en esta computadora: no se envía nada.",
  "telemetry.preview": "Próximo reporte",
  "telemetry.last": "Último envío",
  "telemetry.never": "Todavía no se envió nada",
  "telemetry.id": "Id de telemetría",
  "telemetry.steps": "Pasos enviados",
  "telemetry.stat.tokens_in": "Tokens de entrada",
  "telemetry.stat.tokens_out": "Tokens de salida",
  "telemetry.stat.runs": "Turnos",
  "telemetry.stat.projects": "Proyectos",
  "telemetry.stat.agents": "Agentes",
  "telemetry.stat.channels": "Canales",
  "telemetry.stat.routines": "Rutinas",
  "telemetry.stage.installed": "Instalado",
  "telemetry.stage.opened": "Abierto",
  "telemetry.stage.consent": "Respuesta sobre estadísticas",
  "telemetry.stage.setup": "Setup terminado",
  "telemetry.stage.first_run": "Primer uso",
  "telemetry.stage.updated": "Actualizado",
};
