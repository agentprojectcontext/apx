import type { MessageKey } from "./en.ts";

// Llamadas con un agente, donde las muestra la primera pantalla: el botón de la barra, la fila y el encabezado.
export const esCallSlim: Partial<Record<MessageKey, string>> = {
  "call.titled": "Llamada · {when}",
  "call.name": "Llamada",
  "call.calls": "Llamadas",
  "call.count": "{n} llamadas",
  "call.open": "Mostrar tus llamadas",
  "call.close": "Ocultar tus llamadas",
  "call.personal": "Personal",
  "call.start": "Llamar a {name}",
  "call.again": "Volver a llamar",
  "call.back": "Volver a la llamada",
  "call.from": "De una llamada",
  "call.noFiles": "Los archivos no entran en una llamada: mandalos cuando termine.",
};
