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
  "storage.delete": "Borrar",
  "storage.deleteFailed": "No se pudo borrar: {error}",
  "storage.computers.agents": "La computadora de tus agentes",
  "storage.computers.lab": "Computadora de prueba que quedó: {name}",
  "storage.computers.on": "Encendida",
  "storage.computers.off": "Apagada",
  "storage.computers.lastUse": "usada {when}",
  "storage.computers.offFirst": "Apagala para poder borrarla.",
  "storage.computers.turnOff": "Apagar",
  "storage.computers.turnOffFailed": "No se pudo apagar: {error}",
  "storage.computers.empty": "No hay computadoras de los agentes en este disco.",
  "storage.computers.confirmAgentsTitle": "¿Borrar la computadora de tus agentes?",
  "storage.computers.confirmLabTitle": "¿Borrar la computadora de prueba {name}?",
  "storage.computers.confirmAgents":
    "Se pierde todo lo que tus agentes instalaron o guardaron adentro, y se liberan {size}. Se vuelve a preparar desde cero la próxima vez que un agente la necesite.",
  "storage.computers.confirmLab":
    "Se pierde todo lo que se instaló o guardó adentro, y se liberan {size}. La dejó una prueba; APX no la usa.",
  "storage.computers.deleted": "Computadora borrada. Se liberaron {size}.",
  "storage.backups.empty": "No hay copias de seguridad.",
  "storage.backups.confirmTitle": "¿Borrar la copia del {date}?",
  "storage.backups.confirmBody":
    "Esta copia de tus chats, memoria y tareas se borra para siempre, y se liberan {size}. Lo que APX tiene ahora queda como está.",
  "storage.backups.deleted": "Copia borrada. Se liberaron {size}.",
  "storage.compact.title": "Achicar el archivo de chats",
  "storage.compact.hint":
    "La salida vieja de comandos y archivos que tus agentes ya no leen queda como una nota corta, y el archivo devuelve el espacio. Antes se guarda una copia en Copias de seguridad.",
  "storage.compact.cta": "Compactar",
  "storage.compact.confirmTitle": "¿Compactar el archivo de chats?",
  "storage.compact.confirmBody":
    "Los chats y las rutinas esperan hasta que termine, de unos segundos a unos minutos. Antes se guarda una copia del archivo en Copias de seguridad; borrala desde acá cuando ya no la necesites.",
  "storage.compact.done": "Compactado: {before} → {after}. Se guardó una copia en Copias de seguridad.",
  "storage.compact.keptSize":
    "Compactado, pero el archivo mantiene su tamaño hasta que el disco tenga lugar para reescribirlo. Se guardó una copia en Copias de seguridad.",
  "storage.compact.noRoom":
    "No se cambió nada: el disco no tiene lugar para una copia del archivo y su reescritura. Liberá espacio y probá de nuevo.",
  "storage.compact.failed": "No se pudo compactar: {error}",
};
