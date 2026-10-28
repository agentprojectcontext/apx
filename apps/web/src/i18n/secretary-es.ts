import type { enSecretary } from "./secretary-en.ts";

export const esSecretary: Record<keyof typeof enSecretary, string> = {
  "super.capabilities": "Capacidades de secretaría",
  "super.capabilitiesHint":
    "Asistencia propia del superagente, no rutinas que tengas que crear. Se conservan tus instrucciones y la actividad existente. Activar programa la próxima revisión; no envía nada ahora.",
  "super.mailAvailability":
    "Lee mails nuevos sólo con Gmail conectado usando tu propio cliente de Google. Si no, espera sin llamar al modelo. SMTP solo no permite leer tu bandeja.",
  "super.customize": "Personalizar instrucciones",
  "super.instructions": "Instrucciones",
  "super.connectMail": "Conexión de Gmail",
  "super.mailConnected":
    "Gmail está conectado para lectura. Se respetan la disponibilidad por proyecto y las horas de silencio.",
  "super.mailWaiting": "La revisión de mails espera una conexión de Gmail con acceso de lectura.",
  "super.calendarAvailability":
    "Te recuerda los eventos de tu Google Calendar antes de que empiecen, con la anticipación de Avisar eventos. Espera sin llamar al modelo hasta que conectes Calendar.",
  "super.connectCalendar": "Conexión de Google Calendar",
  "super.lastCheck": "Última revisión",
};
