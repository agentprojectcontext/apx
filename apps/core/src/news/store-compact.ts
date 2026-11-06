import type { NewsEntry } from "./entries.ts";

// Settings › Storage › Compact and `apx doctor --fix` (DECISIONS.md#d-200): told only while a big store still keeps
// its free space, which an install from before 2.13 does until it is rewritten once.
export const STORE_COMPACT_NEWS: NewsEntry = {
  id: "store-compact",
  since: "2.13.0",
  title: { en: "Make APX's chat file smaller", es: "Achicá el archivo de chats de APX" },
  about: {
    en:
      "The file that holds your chats is big. Settings › Storage › Compact shrinks it once, and from then on APX keeps " +
      "it small by itself. Chats wait while it runs, from a few seconds to a few minutes.",
    es:
      "El archivo donde se guardan tus chats es grande. Configuración › Almacenamiento › Compactar lo achica una vez, y " +
      "desde ahí APX lo mantiene chico solo. Los chats esperan mientras corre, de unos segundos a unos minutos.",
  },
  applies: (f) => f.bigStore === true,
  text:
    "APX now trims what the chats' history keeps beyond what any model still reads (tool output it held twice, long " +
    "outputs of turns more than two weeks old) every few minutes, and a store made from now on gives the freed space " +
    "back to the disk by itself. This owner's store is from before and still big: it gives space back only after one " +
    "rewrite. The owner runs it from Settings › Storage › Compact (or `apx doctor --fix` in the terminal); agents " +
    "cannot, because chats and routines wait while it runs, about a minute per GB. It first saves a copy of the file " +
    "in Backups, which stays until the owner deletes it, and needs room for that copy plus about twice the file's " +
    "size on the disk. What a chat sends to its model does not change; going back to a message more than two " +
    "weeks old, the agent sees old tool output as a short note and calls the tool again if needed.",
  actions: [
    {
      label: { en: "What does it change?", es: "¿Qué cambia?" },
      prompt:
        "Tell me in a few lines what compacting APX's chat file does, how long it takes and what I lose, if anything.",
    },
  ],
};
