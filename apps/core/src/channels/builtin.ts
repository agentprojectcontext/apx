import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Keep an unused channel's transport out of the core until its first account is configured. */
function defer<F extends (...args: never[]) => unknown>(load: () => F): F {
  let factory: F | undefined;
  return ((...args: never[]) => {
    factory ??= load();
    return factory(...args);
  }) as F;
}

export const discordAdapter = defer(() => (require("./discord.ts") as typeof import("./discord.ts")).discordAdapter);
export const emailAdapter = defer(() => (require("./email.ts") as typeof import("./email.ts")).emailAdapter);
export const googlechatAdapter = defer(
  () => (require("./googlechat.ts") as typeof import("./googlechat.ts")).googlechatAdapter,
);
export const imessageAdapter = defer(
  () => (require("./imessage.ts") as typeof import("./imessage.ts")).imessageAdapter,
);
export const ircAdapter = defer(() => (require("./irc.ts") as typeof import("./irc.ts")).ircAdapter);
export const lineAdapter = defer(() => (require("./line.ts") as typeof import("./line.ts")).lineAdapter);
export const matrixAdapter = defer(() => (require("./matrix.ts") as typeof import("./matrix.ts")).matrixAdapter);
export const mattermostAdapter = defer(
  () => (require("./mattermost.ts") as typeof import("./mattermost.ts")).mattermostAdapter,
);
export const nextcloudAdapter = defer(
  () => (require("./nextcloud.ts") as typeof import("./nextcloud.ts")).nextcloudAdapter,
);
export const ntfyAdapter = defer(() => (require("./ntfy.ts") as typeof import("./ntfy.ts")).ntfyAdapter);
export const signalAdapter = defer(() => (require("./signal.ts") as typeof import("./signal.ts")).signalAdapter);
export const slackAdapter = defer(() => (require("./slack.ts") as typeof import("./slack.ts")).slackAdapter);
export const smsAdapter = defer(() => (require("./sms.ts") as typeof import("./sms.ts")).smsAdapter);
export const teamsAdapter = defer(() => (require("./teams.ts") as typeof import("./teams.ts")).teamsAdapter);
export const telegramAdapter = defer(
  () => (require("./telegram.ts") as typeof import("./telegram.ts")).telegramAdapter,
);
export const twitchAdapter = defer(() => (require("./twitch.ts") as typeof import("./twitch.ts")).twitchAdapter);
export const whatsappAdapter = defer(
  () => (require("./whatsapp.ts") as typeof import("./whatsapp.ts")).whatsappAdapter,
);
