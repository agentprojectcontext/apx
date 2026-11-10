import type { MessageKey } from "./en.ts";

// La conversación del chat: los archivos que cambió un turno.
export const esChatSlim: Partial<Record<MessageKey, string>> = {
  "chat.changes.showMore": "Ver {n} más",
  "chat.changes.showLess": "Ver menos",
};
