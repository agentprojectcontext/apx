import type { MessageKey } from "./en.ts";

// Herramientas del panel lateral: la tira de pestañas bajo cada encabezado (primero la lista, después lo abierto).
export const esPanelTabs: Partial<Record<MessageKey, string>> = {
  "panelTabs.close": "Cerrar {name}",
  "panelTabs.all": "Todos ({n})",
  "panelTabs.ran": "Ejecutados ({n})",
  "panelTabs.files": "Archivos ({n})",
  "panelTabs.explorer": "Explorador",
  "panelTabs.pages": "Páginas web ({n})",
  "panelTabs.widgets": "Widgets ({n})",
  "panelTabs.apps": "Apps ({n})",
  "panelTabs.commands": "Comandos ({n})",
  "panelTabs.browserHint": "El agente espera hasta que le devuelvas la pestaña.",
  "panelTabs.computerUsing": "{name} está usando la computadora",
};
