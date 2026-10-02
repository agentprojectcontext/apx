import type { MessageKey } from "../i18n/index.ts";

/** The kinds of channel APX knows, in the order they are offered; `soon` ones cannot be connected yet. */
export const CHANNEL_KINDS = {
  telegram: { name: "channel.telegram.name", text: "channel.telegram.text", tone: "info", soon: false },
  whatsapp: { name: "channel.whatsapp.name", text: "channel.whatsapp.text", tone: "brand", soon: true },
  discord: { name: "channel.discord.name", text: "channel.discord.text", tone: "violet", soon: true },
} as const satisfies Record<string, { name: MessageKey; text: MessageKey; tone: string; soon: boolean }>;

export type ChannelKind = keyof typeof CHANNEL_KINDS;
export const CHANNEL_KIND_IDS = Object.keys(CHANNEL_KINDS) as ChannelKind[];

export const isChannelKind = (v: string): v is ChannelKind => Object.hasOwn(CHANNEL_KINDS, v);
