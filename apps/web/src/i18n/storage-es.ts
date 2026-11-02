import type { enStorage } from "./storage-en.ts";

export const esStorage: Record<keyof typeof enStorage, string> = {
  "storage.lead": "Lo que APX guarda en esta computadora, y el espacio que podés recuperar.",
  "storage.disk": "Disco",
  "storage.diskFree": "{free} libres de {total}",
  "storage.diskLow": "Tu disco está casi lleno. Cuando se acabe, APX no podrá guardar chats ni archivos.",
  "storage.apx": "APX usa",
  "storage.measuring": "Midiendo…",
  "storage.partial": "Como mínimo: había demasiado para contarlo todo.",
  "storage.free": "Liberar espacio",
  "storage.freeHint":
    "Borra la caché y los registros viejos que APX vuelve a crear cuando los necesita. Tus chats, memoria, archivos, proyectos y copias de seguridad quedan.",
  "storage.freeCta": "Liberar {size}",
  "storage.nothing": "No hay nada para liberar",
  "storage.freed": "Se liberaron {size}.",
  "storage.failed": "No se pudo liberar espacio: {error}",
  "storage.unavailable": "No se pudo leer el almacenamiento: {error}",
};
