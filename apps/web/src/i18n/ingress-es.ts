import type { enIngress } from "./ingress-en.ts";

export const esIngress: Record<keyof typeof enIngress, string> = {
  "ingress.base": "Dirección pública base",
  "ingress.baseHint":
    "La comparten los webhooks firmados de canales, los Flows protegidos con token y los widgets publicados explícitamente. El panel y el RPC siguen privados.",
  "ingress.routes": "Endpoints públicos",
  "ingress.routesHint":
    "Cada Flow necesita su propio token bearer. Al habilitar o rotar un token, el anterior deja de servir de inmediato. LINE y Teams usan las firmas de su plataforma. Los widgets publicados son de solo lectura y no necesitan token bearer.",
  "ingress.noRoutes":
    "Creá un Flow con webhook para registrar un endpoint. No se expone ningún endpoint genérico por defecto.",
  "ingress.enabled": "Token habilitado",
  "ingress.revoked": "Token deshabilitado",
  "ingress.rotate": "Rotar token",
  "ingress.enable": "Habilitar token",
  "ingress.revoke": "Revocar token",
  "ingress.copied": "Copiado",
  "ingress.copyToken": "Copiar token",
  "ingress.hideToken": "Ocultar token",
  "ingress.tokenHint":
    "Token para {path}. Mandalo en Authorization: Bearer <token>, nunca en la URL. Guardalo en los secretos del servicio que llama; se oculta al salir de esta página.",
  "hooks.lead":
    "Una dirección HTTPS para webhooks firmados de canales, Flows protegidos con token y widgets publicados explícitamente. Solo se admiten rutas registradas: nunca el panel ni la API. El proveedor da el dominio o la IP pública; APX no promete una IP fija.",
  "hooks.tailscaleBody":
    "Tailscale Funnel da una dirección https fija en el puerto 8443. Gratis; Funnel tiene que estar permitido para este equipo en tu tailnet.",
  "hooks.ngrokBody":
    "APX arranca ngrok por vos. Una cuenta gratis suele mantener la misma dirección; si ngrok da una nueva, esta pantalla te avisa.",
  "hooks.customBody": "Tu propia dirección https, delante del puerto de webhooks (un proxy o un servidor tuyo).",
  "hooks.ngrokMissing": "ngrok no está instalado: instalalo y corré “ngrok config add-authtoken <tu token>” una vez.",
  "hooks.mayChange":
    "Esta dirección de ngrok es nueva: pegala en la plataforma. Si ngrok da otra después de un reinicio, te lo vuelve a avisar acá.",
};
