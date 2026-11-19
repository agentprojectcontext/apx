import type { NewsEntry } from "./entries.ts";

// Told once to every owner: the optional APX account, needed only to publish (DECISIONS.md#d-247).
export const APX_ACCOUNT_NEWS: NewsEntry = {
  id: "apx-account",
  since: "2.16.0",
  title: {
    en: "Your APX account, with Google",
    es: "Tu cuenta APX, con Google",
  },
  about: {
    en:
      "In Settings › Account you can now sign in with Google and get your APX ID, with your name and photo. It is " +
      "optional: everything keeps working without it, and it uploads only your profile, never your projects or chats.",
    es:
      "En Configuración › Cuenta ahora podés iniciar sesión con Google y tener tu ID de APX, con tu nombre y tu foto. " +
      "Es opcional: todo sigue andando sin ella, y solo sube tu perfil, nunca tus proyectos ni tus chats.",
  },
  applies: () => true,
  text:
    "The owner can sign in to an optional APX account with Google in Settings › Account: it shows their name, photo " +
    "and an eight-character APX ID, and it is what publishing an artifact with a public link needs. Signing in and " +
    "out is the owner's, in the browser of the computer where APX runs; you cannot do it for them. It uploads only " +
    "the profile, never projects, chats or memory. Mention it when the owner wants to share something publicly.",
  actions: [
    {
      label: { en: "What is it for", es: "Para qué sirve" },
      prompt: "Tell me in two lines what the APX account is for and where I sign in. Don't change anything.",
    },
  ],
};
