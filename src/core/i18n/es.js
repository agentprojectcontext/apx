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
  // Movilidad — los botones y recordatorios de una línea que manda el DAEMON
  // durante un viaje (core/mobility/geofence.js). Los emite el host, no el
  // modelo: se leen manejando, así que quedan fijos y cortos.
  "mobility.near": "Estás cerca de {place}, a {distance}.",
  // Sin lugar con nombre propio: el título ya lo dijo, así que la línea sólo
  // aporta la distancia.
  "mobility.near_bare": "Estás a {distance}.",
  "mobility.unit_m": "metros",
  "mobility.unit_km": "kilómetros",
  "mobility.task": "Tarea",
  "mobility.address": "Dirección",
  // Las cuatro respuestas de la tarjeta nativa, en el orden en que se ofrecen.
  // Sin emojis: Android Auto se las da al Assistant y las lee en voz alta.
  "mobility.navigate": "Navegar ahora",
  "mobility.add_stop": "Sumar a la ruta",
  "mobility.later": "Para después",
  "mobility.dismiss": "No ahora",
  "mobility.ack_dismissed": "Listo, no te aviso más de esta en este viaje.",
  "mobility.going": "Voy",
  "mobility.not_today": "Hoy no",
  "mobility.alert_next": "Avisar en la siguiente",
  "mobility.followup": "¿Pasaste por {place}?",
  "mobility.done": "Hecho",
  "mobility.still_open": "Todavía no",
  "mobility.ack_going": "Anotado: vas.",
  "mobility.ack_skipped": "Listo, hoy no.",
  "mobility.ack_next": "Listo, te aviso en la siguiente.",
  "mobility.ack_done": "Cerré la tarea.",
  "mobility.ack_still_open": "La dejo abierta.",
  "mobility.transcript": "[Transcripción]",
  // Pisos de avisos que el daemon manda solo (routines/delivery.js). Primero
  // los redacta el modelo; estos salen únicamente si ningún modelo pudo.
  "quota.stop_notice": "⚠️ {model} se quedó sin cuota. Frené el trabajo en segundo plano (empezando por la rutina {routine}) en vez de gastar los otros proveedores; lo vuelvo a probar después de las {until}. Si lo querés antes, cambiá el modelo del router.",
  "delivery.notice_reply": "{who} te dejó un mensaje{notify} — respondé en su chat.",
  "delivery.notice_critical": "⚠️ {who} marcó algo crítico{notify} — revisalo ahora en su chat.",
  "whatsapp.reply_failed": "⚠️ No pude contestarle a {name} por WhatsApp: ningún modelo respondió ({error}). No le mandé ningún texto fijo; lo reintento a las {at} leyendo la charla.",
  "whatsapp.reply_gave_up": "⚠️ Sigo sin poder contestarle a {name} por WhatsApp después de {attempts} intentos ({error}). Queda pendiente: cuando escriba de nuevo lo retomo, o pedímelo con `apx whatsapp follow-up`.",
};
