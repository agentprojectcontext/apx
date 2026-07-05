// Plugin catalog — the source of truth for which integration plugins exist and
// which are wired end-to-end. The daemon API + web "Plugins" tab read this.
//
// A plugin is "implemented" when it has a service module in ./plugins/ that
// satisfies the lifecycle contract (configure/validate/status/deactivate). The
// rest are declared here with `coming_soon: true` so the Integrations page shows
// the full roster (matching PandaProject) while remaining honest about what is
// actually connectable. Adding a new plugin = drop a module in ./plugins/ and
// register it in PLUGIN_SERVICES — no API or route changes (open/closed).
import { asanaPlugin } from "./plugins/asana.js";

// slug -> live plugin service (must implement the lifecycle contract).
export const PLUGIN_SERVICES = Object.freeze({
  asana: asanaPlugin,
});

// Static descriptors for the catalog UI. Implemented plugins derive their
// metadata from the service module; coming-soon ones are declared inline.
// `coming_soon` entries in PandaProject depend on domain/channel infrastructure
// (GitHub outputs↔repos, a WhatsApp-Web bridge, Telegram-voice whisper) that
// APX models differently — they are placeholders until ported natively.
const COMING_SOON = [
  {
    slug: "github",
    name: "GitHub",
    type: "source_control",
    description: "Vinculá repos, issues y PRs para que los agentes trabajen sobre tu código",
    auth: "token",
    coming_soon: true,
  },
  {
    slug: "whatsapp",
    name: "WhatsApp",
    type: "channel",
    description: "Conectá WhatsApp Web al orquestador — responde mensajes automáticamente",
    auth: "qr",
    coming_soon: true,
  },
  {
    slug: "local-transcription",
    name: "Transcripción Local",
    type: "transcription",
    description: "Transcripción de audio con faster-whisper local — sin depender de una API externa",
    auth: "none",
    coming_soon: true,
  },
];

// The full catalog: implemented plugins first, then coming-soon.
export function listCatalog() {
  const implemented = Object.values(PLUGIN_SERVICES).map((p) => ({
    slug: p.slug,
    name: p.name,
    type: p.type,
    description: p.description,
    auth: p.auth,
    tools: p.tools || [],
    coming_soon: false,
  }));
  return [...implemented, ...COMING_SOON];
}

// Resolve a live plugin service by slug (or null when not implemented).
export function getPluginService(slug) {
  return PLUGIN_SERVICES[slug] || null;
}
