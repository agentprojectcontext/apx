// Release news worth acting on: what a release lets the super-agent do for this owner. Each entry is told once, and
// only to an owner it applies to. See rules/DECISIONS.md#d-117
import type { Store } from "../domain/store.ts";
import { CATALOG } from "../integrations/catalog.ts";

/** What an entry may ask about this install before it is told. */
export type NewsFacts = {
  /** The owner's widgets and apps, in every project. */
  artifacts: number;
  /** Google's parts signed in to, and whether Gmail can be read (the owner's own client: APX's only sends). */
  google: { calendar: boolean; gmail: boolean; drive: boolean; gmailReadable: boolean };
  /** The super-agent runs the secretary profile (chief of staff). */
  secretary: boolean;
  /** People other than the owner write to them on a channel (contacts the agents answer). */
  contacts: boolean;
  /** Channels the owner connected (Telegram, WhatsApp…). */
  channels: number;
  /** Catalog integrations the owner connected (GitHub, Notion…). */
  integrations: number;
  /** This core can run the isolated Linux computer (a Mac with Apple Silicon) and the owner has a project to try there. */
  computer: boolean;
  /** This core runs on a Mac and the owner has work there (a project). */
  mac: boolean;
};

export type NewsAction = {
  /** The button, in the owner's language (English for any other). */
  label: { en: string; es: string };
  /** What pressing it says to the super-agent, as the owner's words. */
  prompt: string;
};

export type NewsEntry = {
  /** Stable and short: it travels in a channel button's id (64 bytes on Telegram). */
  id: string;
  /** The first release that has it. */
  since: string;
  /** A few words, for the list and when several are told at once. */
  title: string;
  applies: (facts: NewsFacts) => boolean;
  /** What changed, for the super-agent to tell in its own words (English; the model writes the owner's language). */
  text: string;
  actions: NewsAction[];
};

export const NEWS: readonly NewsEntry[] = [
  {
    id: "artifacts-kit",
    since: "2.8.0",
    title: "Widgets remember and can become apps",
    applies: (f) => f.artifacts > 0,
    text:
      "Widgets now remember their last reading, so they open with data at once; they can stay live while hidden; " +
      "they have a new look (aurora); and one can become an app with its own records.",
    actions: [
      {
        label: { en: "Update my widgets", es: "Actualizar mis widgets" },
        prompt:
          "Review my widgets and offer to update them to the new APX Kit design and memory (the last reading kept, " +
          "live where it helps). Tell me which ones you would change and how before changing them; hand the work to " +
          "my agents if you prefer.",
      },
      {
        label: { en: "Make one an app", es: "Convertir uno en app" },
        prompt:
          "Look at my widgets and suggest which one would work better as an app (keeping records, its own screens). " +
          "Say why, and wait for my yes before building it.",
      },
    ],
  },
  {
    id: "google",
    since: "2.9.0",
    title: "Google Calendar, Gmail and Drive",
    applies: (f) => !f.google.calendar,
    text:
      "The super-agent can now use the owner's Google account: create meetings with a Google Meet link and invite " +
      "people, move or cancel them and add guests later, find free time; read and send mail; find, read and write " +
      "Docs in Drive. Calendar connects with one click and no Google Cloud setup; reading all of Gmail and Drive uses " +
      "the owner's own OAuth client, which the dialog walks them through once.",
    actions: [
      {
        label: { en: "Connect Calendar", es: "Conectar Calendar" },
        prompt:
          "Help me connect Google Calendar: link me to Resources › Integrations, say in a line what it lets you do " +
          "for me, and once it is connected tell me what I have this week.",
      },
      {
        label: { en: "What can you do?", es: "¿Qué podés hacer?" },
        prompt:
          "Tell me in a few lines what you can do with my Google Calendar, Gmail and Drive once they are connected, " +
          "and which one I should connect first for how I work.",
      },
    ],
  },
  {
    id: "mail-alerts",
    since: "2.9.0",
    title: "Important mail, as it lands",
    applies: (f) => f.secretary && f.google.gmailReadable,
    text:
      "As chief of staff, the super-agent now reads new mail every few minutes and tells the owner only what needs " +
      "them soon; ads and social mail never reach it, and nothing new costs nothing. The owner's 👍 or 👎 on those " +
      "messages teach it. Its morning brief also reads today's events from Google Calendar.",
    actions: [
      {
        label: { en: "How do you choose?", es: "¿Cómo elegís?" },
        prompt:
          "Explain in a few lines how you decide which new mail to tell me about, then ask me which senders or " +
          "subjects always matter to me and which never do, and remember what I say.",
      },
      {
        label: { en: "Check less often", es: "Revisar menos seguido" },
        prompt:
          "Tell me how often you check my mail now (Settings › Profile › Check mail every) and change it to every " +
          "15 minutes if I say yes.",
      },
    ],
  },
  {
    id: "channel-hours",
    since: "2.10.0",
    title: "Attention hours for contacts",
    applies: (f) => f.contacts,
    text:
      "A channel can now keep attention hours (days, from, to, in the owner's time zone): a contact who writes " +
      "outside them gets no answer then, and the agent answers everything they sent, once, when the hours begin. " +
      "The owner is always answered, and a contact can be marked to be answered at any hour. The owner sets them in " +
      "each channel's settings and on the contact's card, or asks the super-agent, who sets both with " +
      "apx_settings once the owner approves each change.",
    actions: [
      {
        label: { en: "Suggest my hours", es: "Sugerime un horario" },
        prompt:
          "Look at when my contacts usually write to me and suggest attention hours for my channels, and which " +
          "contacts you would answer at any hour. If I agree, set them.",
      },
    ],
  },
  {
    id: "super-agent-settings",
    since: "2.10.0",
    title: "Settings changed from chat",
    // The owner's profile, notices, projects and memory are every owner's: contacts are only part of it.
    applies: () => true,
    text:
      "The super-agent can now change, with apx_settings, almost anything the owner sets up in the panel: a " +
      "contact (who they are, the rules to answer them, their relation), a channel (who answers it, strangers, " +
      "rooms), the owner's own profile and time zone, when they are notified, projects, memory, skills, agent " +
      "profiles, routines, archived agents, tasks, chats, widgets and MCP servers (their keys named by a variable the " +
      "owner saved, never typed in chat). Each change shows the owner the fields before and after, and waits for " +
      "their yes. Saving a key, sign-ins, models, what agents may do and this computer stay the owner's, in Settings.",
    actions: [
      {
        label: { en: "What can you change?", es: "¿Qué podés cambiar?" },
        prompt:
          "Tell me in a few lines what you can change in my APX settings from chat, then ask me what I would like " +
          "to adjust, and change it as I tell you.",
      },
      {
        label: { en: "Set my quiet hours", es: "Configurá mis horas de silencio" },
        prompt: "Ask me when I do not want to be notified and how many notices a day are fine, then set it up.",
      },
    ],
  },
  {
    id: "stickers",
    since: "2.10.0",
    title: "Stickers kept and sent back",
    applies: (f) => f.contacts,
    text:
      "Every sticker someone sends on WhatsApp or Telegram is now kept the moment it arrives, named once by what it " +
      "shows, so the agent understands it and can answer a chat with one of them instead of words, on the same " +
      "platform. They are listed in each channel's settings, under Stickers, where the owner can say what one " +
      "means or that the agent may not use it, and choose whether new ones are the agent's to use at once (the " +
      "default) or wait for their OK; one for adults always waits. Reactions the agent puts now show in the app too.",
    actions: [
      {
        label: { en: "Answer me with a sticker", es: "Contestame con un sticker" },
        prompt:
          "Answer this message with one of the stickers people sent me on this channel, the one that fits best. If " +
          "none is kept here yet, tell me in words that a sticker sent to you is kept and you can use it after.",
      },
    ],
  },
  {
    id: "more-apps",
    since: "2.10.0",
    title: "Fifty more integrations",
    applies: (f) => f.integrations > 0,
    text:
      "Resources › Integrations now connects about fifty more apps, most with one click and a sign-in in the " +
      "browser, nothing to paste: Linear, Jira and Confluence, GitLab, Vercel, Supabase, Stripe, Todoist, Airtable, " +
      "Figma, Canva, Cloudflare, Dropbox, Calendly, PayPal and more; Home Assistant and n8n take their address and a " +
      "token. The catalog has a search box. GitHub, Slack and Brave Search now run on their maintained servers: " +
      "editing and saving one switches it.",
    actions: [
      {
        label: { en: "Which ones help me?", es: "¿Cuáles me sirven?" },
        prompt:
          "Look at what I work on and the integrations I already have, and suggest the two or three new ones from " +
          "Resources › Integrations that would help me most, saying in a line what you would do with each.",
      },
    ],
  },
  {
    id: "more-channels",
    since: "2.10.0",
    title: "New channels",
    applies: (f) => f.channels > 0,
    text:
      "Agents can now be reached on more apps: iMessage on the owner's Mac, Google Chat, SMS through Twilio, ntfy " +
      "push notifications, Nextcloud Talk, IRC and Twitch chat. Each is set up in Settings › Channels, like the others.",
    actions: [
      {
        label: { en: "Set one up", es: "Configurar uno" },
        prompt:
          "Tell me in a few lines which of the new channels (iMessage, Google Chat, SMS, ntfy, Nextcloud Talk, IRC, " +
          "Twitch) would suit how I use you, and walk me through setting up the one I pick.",
      },
    ],
  },
  {
    id: "teams-line",
    since: "2.10.0",
    title: "Microsoft Teams and LINE",
    applies: (f) => f.channels > 0,
    text:
      "Agents can now be reached on Microsoft Teams and LINE. Both send their messages to a web address, so their " +
      "screen in Settings › Channels turns on a public address first: Tailscale Funnel (a fixed address), ngrok " +
      "(started by APX, which says when its address is new) or the " +
      "owner's own. Only a door for webhooks is published, never the panel, and every message is checked.",
    actions: [
      {
        label: { en: "Set up Teams", es: "Configurar Teams" },
        prompt:
          "Walk me through connecting Microsoft Teams: what to create in Azure, how to turn on the public address " +
          "(Tailscale or ngrok, whichever I have), and where to paste each value.",
      },
    ],
  },
  {
    id: "owner-check",
    since: "2.10.0",
    title: "Channel messages checked first",
    applies: (f) => f.channels > 0,
    text:
      "On every channel but Telegram, WhatsApp and Signal, a message that comes as the owner no longer acts by " +
      "itself: those apps cannot always prove who wrote. The super-agent reads it first, asks the owner in the app " +
      "when it is unsure or the request is risky, and then the channel's agent does what was decided and answers " +
      "there. Confirmations and questions are answered in the app (the panel, the desktop or the paired phone); on " +
      "Telegram, WhatsApp and Signal they still can be, except a change to the owner's settings, which is approved " +
      "only in the app.",
    actions: [
      {
        label: { en: "How it works for me", es: "Cómo me queda a mí" },
        prompt:
          "Tell me in a few lines which of my channels act on my word directly and which go through you first, and " +
          "where I approve things now.",
      },
    ],
  },
  {
    id: "linux-computer",
    since: "2.11.0",
    title: "A Linux computer your agents share",
    applies: (f) => f.computer,
    text:
      "Agents can now work on a Linux computer they share, a VM apart from the owner's Mac with no way into the Mac " +
      "or the local network. Each agent gets its own user, files and screen with a desktop and browser. It is off " +
      "for every agent until the owner allows one: in the agent's card or settings, from the card the agent shows " +
      "when it asks, or by asking the super-agent. An allowed agent starts it itself; it does not start without enough free memory, and APX shuts it down " +
      "when the Mac runs short or nobody uses it, keeping its files. The new Computers view shows every allowed agent's " +
      "screen at once, and the owner can turn any of them on or off from there; memory, CPUs and disk are set in the Computer panel.",
    actions: [
      {
        label: { en: "What could you do there?", es: "¿Qué harías ahí?" },
        prompt:
          "Tell me in a few lines what you could do for me on an isolated Linux computer that you cannot do here, " +
          "and how much memory it would take from this Mac. Do not start it unless I say so.",
      },
      {
        label: { en: "Turn it on for an agent", es: "Activarla para un agente" },
        prompt:
          "Tell me which of my agents may use the isolated Linux computer now, and offer to turn it on for the one " +
          "I pick, with my OK on the card.",
      },
    ],
  },
  {
    id: "mac-awake",
    since: "2.11.0",
    title: "The Mac stays awake while agents work",
    applies: (f) => f.mac,
    text:
      "While an agent works on a turn, a command runs or the Linux computer starts, the owner's Mac no longer goes " +
      "to sleep on its own; it may sleep again as soon as nothing runs, and the screen can still turn off. If the " +
      "Mac sleeps anyway (the lid closed), work it interrupted gets another chance instead of being marked stuck. " +
      "The owner turns it off in Settings, Desktop.",
    actions: [
      {
        label: { en: "When does it apply?", es: "¿Cuándo se aplica?" },
        prompt: "Tell me in two lines when APX keeps my Mac awake now and how I turn that off if I prefer it to sleep.",
      },
    ],
  },
];

/** The catalog integrations among the owner's global MCP servers. */
const connectedIntegrations = (store: Store): number => {
  try {
    const servers = JSON.parse(store.settings.get("mcp_servers") ?? "{}") as { mcpServers?: object };
    const names = Object.keys(servers.mcpServers ?? {});
    return CATALOG.filter((e) => names.includes(e.id)).length;
  } catch {
    return 0;
  }
};

const signedIn = (store: Store, id: string) => Boolean(store.settings.get(`google_account:${id}`));

export const newsFacts = (store: Store): NewsFacts => ({
  artifacts: store.surfaces.list().length,
  google: {
    calendar: signedIn(store, "google-calendar"),
    gmail: signedIn(store, "gmail"),
    drive: signedIn(store, "google-drive"),
    gmailReadable: signedIn(store, "gmail") && store.settings.get("google_client:gmail") === "own",
  },
  secretary: store.settings.read("profile").id === "secretary",
  contacts: store.persons.list().some((p) => p.role !== "owner" && p.role !== "blocked" && p.addresses.length > 0),
  channels: store.settings.read("channels").length,
  integrations: connectedIntegrations(store),
  computer: process.platform === "darwin" && process.arch === "arm64" && store.projects.list().length > 0,
  mac: process.platform === "darwin" && store.projects.list().length > 0,
});

/** The action a channel button stands for. */
export const newsAction = (entryId: string, index: number): NewsAction | undefined =>
  NEWS.find((e) => e.id === entryId)?.actions[index];
