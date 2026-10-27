export const enIngress = {
  "ingress.base": "Public base address",
  "ingress.baseHint":
    "Shared by signed channel webhooks, token-protected Flows and explicitly published widgets. The panel and RPC remain private.",
  "ingress.routes": "Public endpoints",
  "ingress.routesHint":
    "Every Flow needs its own bearer token. Enabling or rotating a token immediately invalidates the old one. LINE and Teams use their platform signatures instead. Published widgets are read-only and need no bearer token.",
  "ingress.noRoutes": "Create a webhook Flow to register an endpoint. No generic endpoints are exposed by default.",
  "ingress.enabled": "Token enabled",
  "ingress.revoked": "Token disabled",
  "ingress.rotate": "Rotate token",
  "ingress.enable": "Enable token",
  "ingress.revoke": "Revoke token",
  "ingress.copied": "Copied",
  "ingress.copyToken": "Copy token",
  "ingress.hideToken": "Hide token",
  "ingress.tokenHint":
    "Token for {path}. Send it in Authorization: Bearer <token>, never in the URL. Keep it in the caller's secret store; it will be hidden when you leave this page.",
  "hooks.lead":
    "One HTTPS address for signed channel webhooks, token-protected Flows and explicitly published widgets. Only registered routes are reachable: never the panel or the API. The provider supplies the hostname or public IP; APX does not promise a fixed IP.",
  "hooks.tailscaleBody":
    "Tailscale Funnel gives a fixed https address on port 8443. Free; Funnel must be allowed for this device in your tailnet.",
  "hooks.ngrokBody":
    "APX starts ngrok for you. A free account usually keeps the same address; if ngrok ever gives a new one, this screen tells you.",
  "hooks.customBody": "Your own https address, in front of the webhook port (a proxy or a server you run).",
  "hooks.ngrokMissing": "ngrok is not installed: install it and run “ngrok config add-authtoken <your token>” once.",
  "hooks.mayChange":
    "This ngrok address is new: paste it into the platform. If ngrok gives another one after a restart, this says so again.",
} as const;
