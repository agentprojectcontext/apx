// The super-agent's first words, once the setup is over: a welcome in the owner's language, then a few questions to get
// to know them (name, work, how to talk, what to help with first), each with answers to pick. Written from templates
// (no model call) and kept as the agent's own words; after the last answer the agent itself answers.
import type { Part } from "@apx/protocol";
import { postAgentWords } from "./agent-words.ts";
import { ownerIdentity, saveOwnerIdentity } from "./owner.ts";
import { HOME_THREAD_ID } from "./seed.ts";
import type { Store } from "./store.ts";

export const GREETED_KEY = "setup_greeted";

/** Getting to know the owner, one question at a time; each answer is kept where it belongs. */
export const ONBOARD_STEPS = ["name", "work", "personality", "help"] as const;
export type OnboardStep = (typeof ONBOARD_STEPS)[number];

type Lang = "en" | "es";
type Option = { label: string; value: string };
type Step = { ask: (agent: string, owner: string) => string; options: Option[]; said: (answer: string) => string };

const opt = (label: string, value = label): Option => ({ label, value });

const STEPS: Record<Lang, Record<OnboardStep, Step>> = {
  en: {
    name: {
      ask: (agent) =>
        `Hi! I'm ${agent}, your super-agent, and I'm ready to work with you.\n\nFirst I'd like to get to know you a little. What should I call you?`,
      options: [],
      said: (a) => `Call me ${a}.`,
    },
    work: {
      ask: (_a, owner) => `Nice to meet you${owner ? `, ${owner}` : ""}! What do you do?`,
      options: [opt("I work for a company"), opt("I run my own business"), opt("I'm a freelancer"), opt("I study")],
      said: (a) => `What I do: ${a}.`,
    },
    personality: {
      ask: () => "And how would you like me to talk to you?",
      options: [
        opt("Warm and playful", "Warm and friendly, with a sense of humor; relaxed and close."),
        opt("Direct and brief", "Direct and brief: gets to the point, no filler."),
        opt("Formal and thorough", "Formal and thorough: careful with words, organized and professional."),
      ],
      said: (a) => `I'd like you to be: ${a}.`,
    },
    help: {
      ask: () => "Last one: what should I help you with first?",
      options: [opt("Sorting my email"), opt("My calendar and reminders"), opt("My messages and calls")],
      said: (a) => `Help me first with: ${a}.`,
    },
  },
  es: {
    name: {
      ask: (agent) =>
        `¡Hola! Soy ${agent}, tu super-agente, y ya estoy listo para trabajar con vos.\n\nAntes de arrancar quiero conocerte un poco. ¿Cómo te llamo?`,
      options: [],
      said: (a) => `Decime ${a}.`,
    },
    work: {
      ask: (_a, owner) => `¡Un gusto${owner ? `, ${owner}` : ""}! ¿A qué te dedicás?`,
      options: [opt("Trabajo en una empresa"), opt("Tengo mi negocio"), opt("Soy freelance"), opt("Estudio")],
      said: (a) => `A qué me dedico: ${a}.`,
    },
    personality: {
      ask: () => "¿Y cómo querés que te hable?",
      options: [
        opt("Cercano y con humor", "Cercano, cálido y con humor; relajado y de confianza."),
        opt("Directo y breve", "Directo y breve: va al grano, sin relleno."),
        opt("Formal y prolijo", "Formal y prolijo: cuidadoso con las palabras, ordenado y profesional."),
      ],
      said: (a) => `Quiero que seas así: ${a}.`,
    },
    help: {
      ask: () => "Última: ¿en qué te ayudo primero?",
      options: [opt("Ordenar mi mail"), opt("Mi agenda y recordatorios"), opt("Mis mensajes y llamadas")],
      said: (a) => `Primero ayudame con: ${a}.`,
    },
  },
};

const LANG_KEY = "onboard_language";
const langOf = (store: Store): Lang => (store.settings.get(LANG_KEY) === "en" ? "en" : "es");

/** Posts one question of getting to know the owner, as the super-agent's own words, with its answers to pick. */
function ask(store: Store, agent: { id: string; name: string }, step: OnboardStep, owner: string, note: string): void {
  const s = STEPS[langOf(store)][step];
  const text = s.ask(agent.name, owner);
  const parts: Part[] = [
    { type: "text", text },
    { type: "choices", for: step, options: s.options, custom: true },
  ];
  const offered = s.options.map((o, i) => `${i + 1}. ${o.label}`).join("\n");
  postAgentWords(store, {
    thread_id: HOME_THREAD_ID,
    agent_id: agent.id,
    text,
    parts,
    note,
    said: offered ? `${text}\n\n${offered}` : text,
    unread: false,
  });
}

/**
 * The owner answered one question: their answer is kept (their name, what they do and what to help with first, in
 * their profile) and shown as their words, then the next question comes. After the last one nothing is posted: the
 * panel sends `say` as the owner's message, so the agent answers it knowing them.
 */
export function onboardAnswer(store: Store, step: OnboardStep, answer: string): { next?: OnboardStep; say?: string } {
  const boss = store.agents.list().find((a) => a.kind === "secretary");
  const lang = langOf(store);
  const said = STEPS[lang][step].said(answer.trim());
  const owner = ownerIdentity(store);
  if (step === "name") saveOwnerIdentity(store, { name: answer.trim().slice(0, 80) });
  if (step === "work" || step === "help") {
    const line = step === "work" ? `Work: ${answer.trim()}` : `Wants help first with: ${answer.trim()}`;
    const kept = (owner.about ?? "").split("\n").filter((l) => !l.startsWith(line.split(":")[0] as string));
    saveOwnerIdentity(store, { about: [...kept, line].filter(Boolean).join("\n").slice(0, 2000) });
  }
  const next = ONBOARD_STEPS[ONBOARD_STEPS.indexOf(step) + 1];
  if (!next || !boss) {
    store.modelLog.append(HOME_THREAD_ID, undefined, [
      {
        role: "user",
        content:
          "[APX: the owner finished getting to know you. Their next message is their last answer: greet them by name, tell them in a few short lines what you can do for them here, and offer one first thing to do now.]",
      },
    ]);
    return { say: said };
  }
  store.tx(() => {
    store.messages.add({ thread_id: HOME_THREAD_ID, author: { kind: "user" }, parts: [{ type: "text", text: said }] });
    ask(store, boss, next, ownerIdentity(store).name, `[APX: the owner answered: ${said}]`);
  });
  return { next };
}

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
  store.tx(() => {
    store.settings.set(LANG_KEY, language === "en" ? "en" : "es");
    // The owner just finished the setup there: it is not news waiting for them.
    ask(store, boss, "name", "", "[APX: the owner just finished the setup; you greet them for the first time.]");
    store.settings.set(GREETED_KEY, "1");
  });
  return { thread: thread.id, sent: true };
}
