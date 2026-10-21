import type { MessageKey } from "../i18n/index.ts";
import type { ConfigSection } from "../shell/nav.ts";

/** The name of each settings section the owner can be sent to (palette, app links). */
export const CONFIG_SECTION_LABELS: Partial<Record<ConfigSection, MessageKey>> = {
  account: "config.account",
  appearance: "config.appearance",
  sounds: "config.sounds",
  engines: "config.engines",
  agents: "config.agents",
  memory: "config.memory",
  channels: "config.channels",
  interruptions: "config.interruptions",
  profile: "config.profile",
  browser: "config.browser",
  desktop: "config.desktop",
  devices: "config.devices",
  advanced: "config.advanced",
  logs: "config.logs",
};
