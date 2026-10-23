// The channels APX can run, as the owner and their agents read about them: a name and what it is. The panel has its
// own translated texts; these are the core's, for agents (integrations.find) and default labels.
import type { ChannelType } from "@apx/protocol";

export const CHANNEL_CATALOG: Record<ChannelType, { label: string; description: string }> = {
  telegram: { label: "Telegram", description: "A Telegram bot to chat with your agents and get their messages." },
  whatsapp: {
    label: "WhatsApp",
    description: "Your WhatsApp linked by QR: talk to your agents, and they answer the contacts you allow.",
  },
  discord: { label: "Discord", description: "A Discord bot: direct messages and the server rooms you pick." },
  slack: { label: "Slack", description: "A Slack app you write to in direct messages." },
  matrix: { label: "Matrix", description: "An account on your Matrix server." },
  mattermost: { label: "Mattermost", description: "A bot on your Mattermost server." },
  signal: { label: "Signal", description: "Your Signal number through signal-cli on this computer." },
  email: { label: "Email", description: "A mailbox: it reads what arrives and answers by email (mail, inbox)." },
  imessage: { label: "iMessage", description: "Read and send iMessages and texts on this Mac." },
  googlechat: { label: "Google Chat", description: "A bot in your work account's Google Chat spaces." },
  sms: { label: "SMS", description: "A phone number for text messages, through Twilio." },
  ntfy: { label: "ntfy", description: "Push notifications on your phone, and replies from the ntfy app." },
  nextcloud: { label: "Nextcloud Talk", description: "A bot user on your Nextcloud server." },
  irc: { label: "IRC", description: "A bot on an IRC network." },
  twitch: { label: "Twitch", description: "A bot in a Twitch channel's chat." },
  teams: { label: "Microsoft Teams", description: "A Teams bot in your organization (needs a public address)." },
  line: { label: "LINE", description: "A LINE official account (needs a public address)." },
};
