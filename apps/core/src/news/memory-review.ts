import type { NewsEntry } from "./entries.ts";

export const MEMORY_REVIEW_NEWS: NewsEntry = {
  id: "memory-review",
  since: "2.14.0",
  title: { en: "Go through your notes with your agent", es: "Repasá tus notas con tu agente" },
  about: {
    en: "A project's Memory tab lists each note in a short row; click one to read it whole and edit, forget or trace it. Review with your super-agent opens a chat beside the list to go through the notes one by one.",
    es: "La pestaña Memoria de un proyecto muestra cada nota en una fila corta; con un clic la leés entera y la editás, la olvidás o ves de dónde salió. Revisar con tu super-agente abre un chat al lado de la lista para repasar las notas una por una.",
  },
  applies: () => true,
  text: "A project's Memory tab now shows each note as a short row and opens it in a panel beside the list (whole text, edit, forget, the chat it came from, its earlier revisions). Its Review with button opens a chat with you beside the list, its first message ready, to go through the notes one by one: list them with recall (no words, then offset for the next page), propose what to keep, fix with remember and its id, merge or forget, and wait for the owner's ok before changing one. Tell the owner they can tidy what their agents remember with you whenever the list grows.",
  actions: [
    {
      label: { en: "Review this project's notes", es: "Revisemos las notas de este proyecto" },
      prompt:
        "Let's go through the memory notes you can see, one by one: which are still true, which repeat another and which are out of date. Propose how to leave each one and wait for my ok before changing or forgetting it.",
    },
  ],
};
