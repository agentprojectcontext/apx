// Backend strings — Spanish (es). Keep this file flat dot-paths only; the
// web admin has its own i18n tree.
export default {
  // Pisos, no copy: el ack y los cierres los escribe el modelo
  // (core/agent/author-line.js) y estos textos salen solo si no pudo. Los dos
  // `reply.*` son el piso de TODAS las superficies, no solo el de Telegram —
  // ver core/agent/closing-floor.js.
  "telegram.reset_ack": "Listo, contexto borrado. Arranco un hilo nuevo, ¿qué necesitás?",
  "reply.fallback_done": "Listo.",
  "reply.fallback_continue": "Avancé con eso. ¿Querés que siga?",
  // Pisos de error emitidos por el host (el modelo falló, no puede redactarlos
  // él mismo — quedan fijos, pero al menos respetan el idioma del usuario).
  "telegram.error_agent": "⚠️ El agente tuvo un error ({error}).",
  "telegram.error_generic": "⚠️ No pude responder ahora mismo ({error}).",
};
