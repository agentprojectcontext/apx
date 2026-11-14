import type { MessageKey } from "./en.ts";

// La conversación del chat: los archivos que cambió un turno.
export const esChatSlim: Partial<Record<MessageKey, string>> = {
  "chat.inline.details": "Ver detalles",
  "chat.inline.example": "Datos de ejemplo",
  "chat.changes.showMore": "Ver {n} más",
  "chat.changes.showLess": "Ver menos",
  "quiet.label": "Sin novedades",
  "quiet.noModel": "No se llamó al modelo",
  "quiet.preCommand": "El comando previo no pidió el modelo",
  "notice.details": "Detalles",
};
