import type { MessageKey } from "../i18n/index.ts";

/**
 * The kinds of channel APX knows, in the order they are offered; `soon` ones cannot be connected yet. The list follows
 * what openclaw and hermes connect to.
 */
export const CHANNEL_KINDS = {
  telegram: { name: "channel.telegram.name", text: "channel.telegram.text", tone: "info", soon: false },
  whatsapp: { name: "channel.whatsapp.name", text: "channel.whatsapp.text", tone: "brand", soon: false },
  discord: { name: "channel.discord.name", text: "channel.discord.text", tone: "violet", soon: false },
  slack: { name: "channel.slack.name", text: "channel.slack.text", tone: "warning", soon: false },
  signal: { name: "channel.signal.name", text: "channel.signal.text", tone: "info", soon: false },
  imessage: { name: "channel.imessage.name", text: "channel.imessage.text", tone: "brand", soon: false },
  matrix: { name: "channel.matrix.name", text: "channel.matrix.text", tone: "neutral", soon: false },
  googlechat: { name: "channel.googlechat.name", text: "channel.googlechat.text", tone: "brand", soon: false },
  mattermost: { name: "channel.mattermost.name", text: "channel.mattermost.text", tone: "info", soon: false },
  email: { name: "channel.email.name", text: "channel.email.text", tone: "neutral", soon: false },
  sms: { name: "channel.sms.name", text: "channel.sms.text", tone: "danger", soon: false },
  ntfy: { name: "channel.ntfy.name", text: "channel.ntfy.text", tone: "brand", soon: false },
  nextcloud: { name: "channel.nextcloud.name", text: "channel.nextcloud.text", tone: "info", soon: false },
  irc: { name: "channel.irc.name", text: "channel.irc.text", tone: "neutral", soon: false },
  twitch: { name: "channel.twitch.name", text: "channel.twitch.text", tone: "violet", soon: false },
  // Both deliver only to a webhook: they need the public address (Settings › Channels, in their own screen).
  teams: { name: "channel.teams.name", text: "channel.teams.text", tone: "violet", soon: false },
  line: { name: "channel.line.name", text: "channel.line.text", tone: "brand", soon: false },
} as const satisfies Record<string, { name: MessageKey; text: MessageKey; tone: string; soon: boolean }>;

export type ChannelKind = keyof typeof CHANNEL_KINDS;
export const CHANNEL_KIND_IDS = Object.keys(CHANNEL_KINDS) as ChannelKind[];

export const isChannelKind = (v: string): v is ChannelKind => Object.hasOwn(CHANNEL_KINDS, v);
