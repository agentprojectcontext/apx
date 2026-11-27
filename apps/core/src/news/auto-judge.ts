import type { NewsEntry } from "./entries.ts";

export const AUTO_JUDGE_NEWS: NewsEntry = {
  id: "auto-judge",
  since: "2.18.0",
  title: {
    en: "Auto asks you less",
    es: "Auto te pregunta menos",
  },
  about: {
    en: "In Auto, your helper model now decides the everyday approvals: reading a page, a command in your projects, cleaning up a build. You still get the card for sending as you, paying, secrets and anything outside your projects.",
    es: "En Auto, tu modelo ayudante ahora decide los permisos de todos los días: leer una página, un comando en tus proyectos, limpiar un build. La tarjeta te sigue llegando para mandar en tu nombre, pagar, secretos y lo que esté fuera de tus proyectos.",
  },
  applies: (facts) => Boolean(facts.projects || facts.agents),
  text:
    "In Auto mode the first model of the helper list now judges the cards the mode used to show for medium-risk " +
    "calls (deletions, web reads with data in the URL or after outside content, MCP tools, commands and edits in the " +
    "owner's projects, ssh, new sessions) and lets them run when the owner's words, the task or a project rule ask " +
    "for them. If it says ask, fails or takes over 20 seconds, the card shows as before. Sending or posting as the " +
    "owner, paying, secrets, sudo, writing outside the owner's projects and their own settings always ask. Each " +
    "decision shows as a short line in the chat and in a list of what Auto decided. Manual and Total do not change.",
  actions: [
    {
      label: { en: "See what Auto decided", es: "Ver qué decidió Auto" },
      prompt: "Show me what Auto decided on its own lately, and why, without changing anything.",
    },
  ],
};
