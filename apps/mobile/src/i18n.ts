// The app's few words, in the phone's language (English, Spanish).
const en = {
  pairTitle: "Pair with your computer",
  pairLead: "In APX on your computer, open Config › Devices › Pair a device and scan the QR.",
  scan: "Scan the QR",
  orType: "Or type its address and code",
  address: "Address (http://…:7440)",
  code: "Code",
  pair: "Pair",
  pairing: "Pairing…",
  noCamera: "APX needs the camera to scan the QR.",
  allowCamera: "Allow camera",
  unreachable:
    "This phone cannot reach your computer at any address the QR gave. Are you on the same network or Tailscale?",
  failed: "Could not pair: {error}",
  message: "Message",
  send: "Send",
  unpair: "Unpair",
  offline: "No connection to your computer…",
  you: "You",
  photoAsk: "Your agent asks for a picture",
  takePhoto: "Take it",
  decline: "Not now",
} as const;
type Key = keyof typeof en;
const es: Record<Key, string> = {
  pairTitle: "Vinculá con tu computadora",
  pairLead: "En APX de tu computadora, abrí Config › Dispositivos › Vincular un dispositivo y escaneá el QR.",
  scan: "Escanear el QR",
  orType: "O escribí su dirección y el código",
  address: "Dirección (http://…:7440)",
  code: "Código",
  pair: "Vincular",
  pairing: "Vinculando…",
  noCamera: "APX necesita la cámara para escanear el QR.",
  allowCamera: "Permitir la cámara",
  unreachable:
    "Este teléfono no llega a tu computadora por ninguna de las direcciones del QR. ¿Están en la misma red o en Tailscale?",
  failed: "No se pudo vincular: {error}",
  message: "Mensaje",
  send: "Enviar",
  unpair: "Desvincular",
  offline: "Sin conexión con tu computadora…",
  you: "Vos",
  photoAsk: "Tu agente te pide una foto",
  takePhoto: "Sacarla",
  decline: "Ahora no",
};

const lang = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith("es") ? es : en;

export function t(key: Key, vars: Record<string, string> = {}): string {
  return lang[key].replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}
