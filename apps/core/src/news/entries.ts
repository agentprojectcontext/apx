// Release news worth acting on: what a release lets the super-agent do for this owner. Each entry is told once, and
// only to an owner it applies to. See rules/DECISIONS.md#d-117
import type { Store } from "../domain/store.ts";

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
    since: "2.9.1",
    title: "Attention hours for contacts",
    applies: (f) => f.contacts,
    text:
      "A channel can now keep attention hours (days, from, to, in the owner's time zone): a contact who writes " +
      "outside them gets no answer then, and the agent answers everything they sent, once, when the hours begin. " +
      "The owner is always answered, and a contact can be marked to be answered at any hour. It is set in each " +
      "channel's settings, under Attention hours, and on the contact's card.",
    actions: [
      {
        label: { en: "Suggest my hours", es: "Sugerime un horario" },
        prompt:
          "Look at when my contacts usually write to me and suggest attention hours for my channels. Then tell me " +
          "where to set them (Settings › Channels, the channel, Attention hours) and which contacts you would " +
          "answer at any hour.",
      },
    ],
  },
  {
    id: "stickers",
    since: "2.9.1",
    title: "Stickers kept and sent back",
    applies: (f) => f.contacts,
    text:
      "Every sticker someone sends on WhatsApp or Telegram is now kept the moment it arrives, named once by what it " +
      "shows, so the agent understands it and can answer a chat with one of them instead of words, on the same " +
      "platform. Reactions the agent puts on messages now show in the app too, and the chat list says it reacted.",
    actions: [
      {
        label: { en: "Answer me with a sticker", es: "Contestame con un sticker" },
        prompt:
          "Answer this message with one of the stickers people sent me on this channel, the one that fits best. If " +
          "none is kept here yet, tell me in words that a sticker sent to you is kept and you can use it after.",
      },
    ],
  },
];

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
});

/** The action a channel button stands for. */
export const newsAction = (entryId: string, index: number): NewsAction | undefined =>
  NEWS.find((e) => e.id === entryId)?.actions[index];
