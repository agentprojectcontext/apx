// Plugin catalog — the source of truth for which integration plugins exist and
// which are wired end-to-end. The daemon API + web "Plugins" tab read this.
//
// A plugin is "implemented" when it has a service module in ./plugins/ that
// satisfies the lifecycle contract (configure/validate/status/deactivate) and
// declares a `ui` descriptor the generic PluginConnect component renders. The
// rest carry `coming_soon: true`. Adding a plugin = drop a module in ./plugins/
// + register it in PLUGIN_SERVICES (open/closed) — no API/route changes.
//
// Scope of this catalog (per product decision): Asana, GitHub, WhatsApp only.
// Telegram is intentionally absent — it's a channel, configured under its own
// surface, not a service plugin. Transcription lives with the desktop STT stack.
import { asanaPlugin } from "./plugins/asana.js";
import { githubPlugin } from "./plugins/github.js";

// slug -> live plugin service (must implement the lifecycle contract).
export const PLUGIN_SERVICES = Object.freeze({
  asana: asanaPlugin,
  github: githubPlugin,
});

// Static descriptors for plugins that are declared but not yet connectable.
// WhatsApp needs a WhatsApp-Web bridge (QR pairing) that APX doesn't ship yet,
// so it stays coming-soon rather than pretending to connect.
const COMING_SOON = [
  {
    slug: "whatsapp",
    name: "WhatsApp",
    type: "channel",
    description: "Conectá WhatsApp Web al orquestador — responde mensajes automáticamente",
    auth: "qr",
    coming_soon: true,
  },
];

// The full catalog: implemented plugins first, then coming-soon. Implemented
// entries carry their `ui` descriptor + tools so the generic component can
// render their config form.
export function listCatalog() {
  const implemented = Object.values(PLUGIN_SERVICES).map((p) => ({
    slug: p.slug,
    name: p.name,
    type: p.type,
    description: p.description,
    auth: p.auth,
    tools: p.tools || [],
    ui: p.ui || null,
    coming_soon: false,
  }));
  return [...implemented, ...COMING_SOON];
}

// Resolve a live plugin service by slug (or null when not implemented).
export function getPluginService(slug) {
  return PLUGIN_SERVICES[slug] || null;
}
