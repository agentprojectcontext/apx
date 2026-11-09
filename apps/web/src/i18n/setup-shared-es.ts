// The setup strings other screens use too: they load with the first screen; the rest is the "setup" pack.
import type { MessageKey } from "./en.ts";

export const esSetupShared: Partial<Record<MessageKey, string>> = {
  "setup.import.failed": "Parte no se pudo importar: {error}",
  "setup.engines.model": "Modelo",
  "setup.channels.soon": "Pronto",
  "setup.project.pick": "Elegir carpeta",
  "setup.project.pathPlaceholder": "/ruta/a/tu/proyecto",
  "setup.project.added": "Sumado: {name}",
  "connect.title": "¿Dónde corre",
};
