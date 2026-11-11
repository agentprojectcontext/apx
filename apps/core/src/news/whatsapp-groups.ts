import type { NewsEntry } from "./entries.ts";

// Told once to an owner with a WhatsApp account: its groups can be listed and answered like Telegram's.
export const WHATSAPP_GROUPS_NEWS: NewsEntry = {
  id: "whatsapp-groups",
  since: "2.14.0",
  title: { en: "WhatsApp groups", es: "Grupos de WhatsApp" },
  about: {
    en:
      "Pick the WhatsApp groups APX reads and when your agent answers in each. On your own number they are only read " +
      "until you let it answer there as you.",
    es:
      "Elegí qué grupos de WhatsApp lee APX y cuándo contesta tu agente en cada uno. Con tu propio número solo se leen " +
      "hasta que le permitas contestar ahí como vos.",
  },
  applies: (facts) => facts.whatsapp === true,
  text:
    "A WhatsApp account can now read the groups its line is in, as rooms: only the groups the owner lists (the account's " +
    "settings › Rooms, picked from the line's groups; channels.set rooms), each with a mode (when called, when useful, " +
    "always, read only). Everything said in a listed group is kept in that group's chat; answers there are sealed and " +
    "public. On an account that is the owner's own phone (self_owner), anything said in a group comes from the owner's " +
    "number, so its groups are only read until the owner turns on 'Answer in groups as me' (rooms.as_owner); until then " +
    "no agent may post there either. Offer to set up the groups they want read; change nothing until they say which.",
  actions: [
    {
      label: { en: "Set up my WhatsApp groups", es: "Configurar mis grupos de WhatsApp" },
      prompt:
        "Which of my WhatsApp groups could APX read, and what would each mode mean there? Change nothing until I pick.",
    },
  ],
};
