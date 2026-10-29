import type { enSecretary } from "./secretary-en.ts";

export const esSecretary: Record<keyof typeof enSecretary, string> = {
  "super.capabilities": "Capacidades de secretaría",
  "super.capabilitiesHint":
    "Asistencia propia del superagente, no rutinas que tengas que crear. Se conservan tus instrucciones y la actividad existente. Activar programa la próxima revisión; no envía nada ahora.",
  "super.customize": "Personalizar instrucciones",
  "super.instructions": "Instrucciones",
  "super.lastCheck": "Última revisión",
  "super.mailInGmail": "Se prende y se ajusta en la configuración de Gmail, en Recursos › Integraciones.",
  "super.openGmail": "Abrir integraciones",
};
