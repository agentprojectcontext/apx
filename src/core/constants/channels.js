// Channel names — kept in one place so a typo can't silently route the wrong
// prompt or skip a logging path. Each value is the exact string the daemon
// expects in `channel:` fields of API requests, message records, and
// CHANNEL_PROMPT_FILES keys.
//
// Channels are SURFACES (where the user is). Voice is NOT a channel — it's a
// MODE that layers on top of a surface via channelMeta.voice.
export const CHANNELS = Object.freeze({
  TELEGRAM: "telegram",
  CLI: "cli",
  ROUTINE: "routine",
  API: "api",
  WEB: "web",                 // Web admin big chat
  WEB_SIDEBAR: "web_sidebar", // Web admin docked sidebar
  WEB_CODE: "web_code",       // Web admin `/m/code` (OpenCode-style)
  DECK: "deck",               // Mobile cockpit dashboard
  DESKTOP: "desktop",         // Electron capsule (always voice mode)
  CODE: "code",               // `apx code` — terminal coding session
  DIRECT: "direct",           // Planned: 1:1 channel that isn't a chat platform
  WHATSAPP: "whatsapp",       // Planned: WhatsApp bot integration
});
