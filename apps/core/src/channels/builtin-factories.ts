import path from "node:path";
import type { CoreConfig } from "../config.ts";
import { signatureFor } from "../domain/email-signature-settings.ts";
import type { Store } from "../domain/store.ts";
import type { Log } from "../log.ts";
import {
  discordAdapter,
  emailAdapter,
  googlechatAdapter,
  imessageAdapter,
  ircAdapter,
  lineAdapter,
  matrixAdapter,
  mattermostAdapter,
  nextcloudAdapter,
  ntfyAdapter,
  signalAdapter,
  slackAdapter,
  smsAdapter,
  teamsAdapter,
  telegramAdapter,
  twitchAdapter,
  whatsappAdapter,
} from "./builtin.ts";
import type { AdapterFactory } from "./types.ts";

/** Built-in channel wiring; constructing this table does not load any transport. */
export function builtinFactories(config: CoreConfig, store: Store, log: Log): Record<string, AdapterFactory> {
  const dir = (id: string) => path.join(config.home, "channels", id);
  return {
    telegram: (c, token) => telegramAdapter(c, token, config.telegramApi ?? "https://api.telegram.org"),
    discord: (c, token) => discordAdapter(c, token, config.discord),
    slack: (c, token) => slackAdapter(c, token, config.slackApi ?? "https://slack.com/api"),
    matrix: (c, secret) => matrixAdapter(c, secret),
    mattermost: (c, secret) => mattermostAdapter(c, secret),
    signal: (c, secret) => signalAdapter(c, secret),
    email: (c, password) =>
      emailAdapter(c, password, {
        dir: dir(c.id),
        signature: () => signatureFor(store, "smtp", c.id, c.email?.address),
        owner: (address) => store.persons.byAddress(c.id, address)?.role === "owner",
      }),
    whatsapp: (c) =>
      whatsappAdapter({
        dir: dir(c.id),
        selfOwner: c.self_owner === true,
        rooms: (c.rooms?.rooms ?? []).map((r) => r.id),
        log,
      }),
    imessage: (c, s) => imessageAdapter(c, s, { dir: dir(c.id) }),
    googlechat: (c, secret) => googlechatAdapter(c, secret),
    sms: (c, secret) => smsAdapter(c, secret, { dir: dir(c.id) }),
    ntfy: (c, secret) => ntfyAdapter(c, secret, { dir: dir(c.id) }),
    nextcloud: (c, secret) => nextcloudAdapter(c, secret, { dir: dir(c.id) }),
    irc: (c, secret) => ircAdapter(c, secret),
    twitch: (c, secret) => twitchAdapter(c, secret),
    line: (c, secret) => lineAdapter(c, secret, { dir: dir(c.id) }),
    teams: (c, secret) => teamsAdapter(c, secret, { dir: dir(c.id) }),
  };
}
