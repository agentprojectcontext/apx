import type { NewsEntry } from "./entries.ts";

export const HEADLINE_MODELS_NEWS: NewsEntry = {
  id: "headline-models-2026-11",
  since: "2.14.3",
  title: {
    en: "Gemini 4 Argon and GPT-6 Astra are ready for your agents",
    es: "Gemini 4 Argon y GPT-6 Astra ya están para tus agentes",
  },
  about: {
    en: "The newest models from Google and OpenAI show up in the model picker. Your super-agent can tell you which of your agents would gain from them.",
    es: "Los modelos más nuevos de Google y OpenAI ya aparecen al elegir modelo. Tu super-agente te puede decir a qué agentes les conviene.",
  },
  applies: () => true,
  text: "New headline models are in the catalog: Gemini 4 Argon (and Gemini 4 Carbon) from Google, and GPT-6 Astra next to GPT-6.1 Sol and Terra from OpenAI. They reach the owner through Gemini or OpenAI keys, a ChatGPT sign-in, or OpenCode Zen; which of these the owner has decides what they can use. Tell the owner they are available, in a line, without hype. Offer to look at their agents and the router and say which ones could move to one of them and why (harder reasoning, longer context, cost), checking first which providers they have and that the model lists tool support. Never switch a model without the owner's word.",
  actions: [
    {
      label: { en: "Which agents gain", es: "A qué agentes les sirve" },
      prompt:
        "Look at my agents and the router and tell me which ones would gain from Gemini 4 Argon or GPT-6 Astra, with what I have connected. Do not change anything yet.",
    },
  ],
};
