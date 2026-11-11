import type { ChannelInfo } from "@apx/protocol";
import type { T } from "../i18n/index.ts";
import { CHANNEL_KINDS, isChannelKind } from "./kinds.ts";

/** The app an account runs on, in words ("WhatsApp"). */
export const appName = (c: ChannelInfo, t: T): string =>
  isChannelKind(c.type) ? t(CHANNEL_KINDS[c.type].name) : c.type;

/**
 * What an account is called on screen: the owner's own name for it, else the name its app gives it (a WhatsApp
 * profile, a bot's name), else its number, address or bot. A name that only repeats the app says what its icon does.
 */
export function accountName(c: ChannelInfo, t: T): string {
  const own = c.label.trim();
  const app = appName(c, t);
  const generic = !own || [app, c.type].some((w) => w.toLowerCase() === own.toLowerCase());
  if (!generic) return own;
  return c.account_name ?? c.account ?? c.email?.address ?? (own || app);
}

/** Which account it is, under its name: its number, address or bot, unless the name is already that. */
export function accountWhere(c: ChannelInfo, shownName: string): string | undefined {
  const where = c.account ?? c.email?.address;
  return where && where !== shownName ? where : undefined;
}
