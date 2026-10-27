// The super-agent's first words, once the setup is over: a welcome in the owner's language that asks who they are and
// offers a few personalities to pick. Written from a template (no model call), and kept as the agent's own message.
import type { Part } from "@apx/protocol";
import { HOME_THREAD_ID } from "./seed.ts";
import type { Store } from "./store.ts";
import { previewOf } from "./threads.ts";

export const GREETED_KEY = "setup_greeted";

type Template = { text: (name: string) => string; options: Array<{ label: string; value: string }> };

const TEMPLATES: Record<"en" | "es", Template> = {
  en: {
    text: (name) =>
      `Hi! I'm ${name}, your super-agent, and I'm ready to work with you.\n\n` +
      "Before we start, tell me a bit about yourself: what's your name and what do you do? And how would you like " +
      "me to be? Pick one of these personalities or write your own.",
    options: [
      { label: "Warm and playful", value: "Warm and friendly, with a sense of humor; relaxed and close." },
      { label: "Direct and brief", value: "Direct and brief: gets to the point, no filler." },
      { label: "Formal and thorough", value: "Formal and thorough: careful with words, organized and professional." },
    ],
  },
  es: {
    text: (name) =>
      `¡Hola! Soy ${name}, tu super-agente, y ya estoy listo para trabajar con vos.\n\n` +
      "Antes de arrancar, contame un poco de vos: ¿cómo te llamás y a qué te dedicás? ¿Y cómo querés que sea? " +
      "Elegí una de estas personalidades o escribí la tuya.",
    options: [
      { label: "Cercano y con humor", value: "Cercano, cálido y con humor; relajado y de confianza." },
      { label: "Directo y breve", value: "Directo y breve: va al grano, sin relleno." },
      { label: "Formal y prolijo", value: "Formal y prolijo: cuidadoso con las palabras, ordenado y profesional." },
    ],
  },
};

/**
 * Greets the owner in the super-agent's chat, once per install and only while that chat is empty. The model reads it
 * as what it said, with the options it offered.
 */
export function greetOwner(store: Store, language: string): { thread: string; sent: boolean } {
  const boss = store.agents.list().find((a) => a.kind === "secretary");
  const thread = store.threads.get(HOME_THREAD_ID);
  // A chat already under way (an install in use, v1's chats brought in) is not greeted out of the blue.
  if (!boss || !thread || store.settings.get(GREETED_KEY) === "1" || store.messages.list(thread.id, 1).length) {
    store.settings.set(GREETED_KEY, "1");
    return { thread: HOME_THREAD_ID, sent: false };
  }
  const tpl = language === "es" ? TEMPLATES.es : TEMPLATES.en;
  const text = tpl.text(boss.name);
  const parts: Part[] = [
    { type: "text", text },
    { type: "choices", for: "personality", options: tpl.options, custom: true },
  ];
  const offered = tpl.options.map((o, i) => `${i + 1}. ${o.label}`).join("\n");
  store.tx(() => {
    store.messages.add({ thread_id: thread.id, author: { kind: "agent", id: boss.id }, parts });
    // A history starts at a user item: a note of what happened opens it, then the agent's own words.
    store.modelLog.append(thread.id, undefined, [
      { role: "user", content: "[APX: the owner just finished the setup; you greet them for the first time.]" },
      { role: "assistant", content: `${text}\n\n${offered}` },
    ]);
    store.threads.patch(thread.id, { preview: previewOf(text) });
    store.settings.set(GREETED_KEY, "1");
  });
  return { thread: thread.id, sent: true };
}
