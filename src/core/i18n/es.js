// Backend strings — Spanish (es). Keep this file flat dot-paths only; the
// web admin has its own i18n tree.
export default {
  // Telegram channel
  "telegram.heads_up": "Dale, estoy con eso… 🛠️",
  "telegram.reset_ack": "Listo, contexto borrado. Arranco un hilo nuevo, ¿qué necesitás?",
  "telegram.fallback_listo": "Listo.",
  "telegram.fallback_continue": "Avancé con eso. ¿Querés que siga?",
  // Pisos de error emitidos por el host (el modelo falló, no puede redactarlos
  // él mismo — quedan fijos, pero al menos respetan el idioma del usuario).
  "telegram.error_agent": "⚠️ El agente tuvo un error ({error}).",
  "telegram.error_generic": "⚠️ No pude responder ahora mismo ({error}).",
};
