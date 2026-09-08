// Plugin catalog — the source of truth for which integration plugins exist and
// which are wired end-to-end. The daemon API + web "Plugins" tab read this.
//
// A plugin is "implemented" when it has a service module in ./plugins/ that
// satisfies the lifecycle contract (configure/validate/status/deactivate) and
// declares a `ui` descriptor the generic PluginConnect component renders. The
// rest carry `coming_soon: true`. Adding a plugin = drop a module in ./plugins/
// + register it in PLUGIN_SERVICES (open/closed) — no API/route changes.
//
// Scope of this catalog (per product decision): Asana, GitHub, Obsidian,
// Calendar. Telegram and WhatsApp are intentionally absent — both are CHANNELS,
// configured under their own surface, not service plugins. WhatsApp used to sit
// here as coming-soon, inherited from the PandaProject port; it moved out on
// 2026-09-08 because a per-project integration models it wrong: there is one
// account, and a WhatsApp Web session is a device singleton, so N projects
// pairing N QRs against one number is a contradiction rather than a feature.
// Transcription lives with the desktop STT stack. Obsidian is path-based (a local Vault) rather than
// token-based, and Calendar is user-OAuth-based (auth: "oauth") — see
// plugins/calendar.js for why it acts as you (invites + Meet) instead of as a
// service account.
import { asanaPlugin } from "./plugins/asana.js";
import { calendarPlugin } from "./plugins/calendar.js";
import { githubPlugin } from "./plugins/github.js";
import { obsidianPlugin } from "./plugins/obsidian.js";

// slug -> live plugin service (must implement the lifecycle contract).
export const PLUGIN_SERVICES = Object.freeze({
  asana: asanaPlugin,
  calendar: calendarPlugin,
  github: githubPlugin,
  obsidian: obsidianPlugin,
});

// Static descriptors for plugins that are declared but not yet connectable.
// Empty today — kept (rather than deleted along with the concatenation below)
// so declaring the next coming-soon plugin stays a one-line change.
const COMING_SOON = [];

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
