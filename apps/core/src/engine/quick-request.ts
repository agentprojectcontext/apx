// How a quick request (the voice woken by name) ends: a short back-and-forth that hangs up when the owner says they are
// done, when nobody speaks for a while, or when the voice did not understand. The core decides; the engine says the
// last line and hangs up. See DECISIONS.md#d-289
import type { VoiceLocale } from "@apx/protocol";
import type { RunTimers } from "./engine.ts";

/** Nobody speaks this long after the voice's last word: the request is over. */
export const QUICK_IDLE_MS = 9_000;
/** While a task the owner asked for still runs, the call waits this long for its answer to be told. */
export const QUICK_WAIT_MS = 25_000;
/** The engine was told to hang up and did not: the core hangs up itself. */
export const QUICK_END_GRACE_MS = 10_000;
/** The voice said it did not understand this many turns in a row: it says so and hangs up. */
export const QUICK_MISSES = 2;

export const wallTimers: RunTimers = {
  now: () => Date.now(),
  after(ms, callback) {
    const timer = setTimeout(callback, ms);
    timer.unref();
    return () => clearTimeout(timer);
  },
};

export type QuickEndReason = "goodbye" | "idle" | "confused";

/** The voice's last line for each ending, in the call's language; silence hangs up without a word. */
export const QUICK_LINES: Record<VoiceLocale, { goodbye: string; confused: string }> = {
  "es-AR": { goodbye: "Dale, chau.", confused: "No te entendí; cualquier cosa me volvés a llamar." },
  es: { goodbye: "Vale, adiós.", confused: "No te entendí; cualquier cosa me vuelves a llamar." },
  "en-US": { goodbye: "Okay, bye.", confused: "I didn't get that; call me again anytime." },
};

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Words that close a request on their own ("eso es todo", "cortá", "that's all"), even right after a question. */
const STRONG = [
  "eso es todo",
  "eso era todo",
  "eso seria todo",
  "es todo",
  "nada mas",
  "no nada mas",
  "no gracias",
  "no nada",
  "eso nomas",
  "corta",
  "colga",
  "cortamos",
  "corta nomas",
  "podes cortar",
  "chau",
  "chao",
  "adios",
  "hasta luego",
  "nos vemos",
  "thats all",
  "that is all",
  "thats it",
  "that will be all",
  "thatll be all",
  "nothing else",
  "no thanks",
  "hang up",
  "you can hang up",
  "were done",
  "bye",
  "goodbye",
  "see you",
];
/** Words that close a request, unless they answer what the voice just asked ("¿lo prendo?" "dale, gracias"). */
const WEAK = [
  "listo",
  "gracias",
  "ya esta",
  "esta bien asi",
  "thank you",
  "thanks",
  "im done",
  "all done",
  "all good",
  "done",
];
const phrases = (list: string[]) => list.map((p) => p.split(" ")).sort((a, b) => b.length - a.length);
const ALWAYS = phrases(STRONG);
const ANY = phrases([...STRONG, ...WEAK]);
/** Words that only soften a closing ("bueno, listo", "ok thanks", "muchas gracias, Roby"). */
const SOFT = new Set(
  "bueno ok okay okey dale perfecto genial joya barbaro buenisimo muchas mil re muy bien great cool perfect alright right so well then entonces no".split(
    " ",
  ),
);
const MAX_WORDS = 8;

/**
 * Whether the owner's words close the request: they are made only of closing words ("listo, gracias", "eso es todo",
 * "that's all, thanks") and softeners, with at least one closing word. Anything asked or told along ("listo, ¿y el
 * horno?") is not a goodbye. `names`: the agent's name, often said along ("gracias, Roby"). `answering`: the voice
 * just asked something, so a plain "dale, gracias" is a yes, and only a clear goodbye ("no, nada más") ends it.
 */
export function isGoodbye(text: string, names: string[] = [], answering = false): boolean {
  const words = fold(text).split(" ").filter(Boolean);
  const named = new Set(names.flatMap((n) => fold(n).split(" ")).filter(Boolean));
  const rest = words.filter((w) => !named.has(w));
  if (!rest.length || rest.length > MAX_WORDS) return false;
  const closing = answering ? ALWAYS : ANY;
  let closed = false;
  for (let i = 0; i < rest.length; ) {
    const phrase = closing.find((p) => p.every((w, k) => rest[i + k] === w));
    if (phrase) {
      closed = true;
      i += phrase.length;
    } else if (SOFT.has(rest[i] ?? "")) i++;
    else return false;
  }
  return closed;
}

/** What the voice says when it did not catch the owner ("No te entendí", "¿me repetís?", "sorry, I didn't catch that"). */
const MISSED = new RegExp(
  [
    "no te (entendi|escuche|capte|segui)",
    "no (entendi|escuche|capte) (bien|lo que)",
    "no se entendio",
    "me (lo )?(repetis|repetes|repites|podes repetir|puedes repetir)",
    "repetimelo|repetime|repetilo|repitelo|repitemelo",
    "(didnt|did not|couldnt|could not) (catch|get|understand|hear)",
    "say (that|it) again",
    "(can|could) you repeat",
    "^(perdon|sorry|pardon|como|what)$",
  ].join("|"),
);

export function isMissed(said: string): boolean {
  return MISSED.test(fold(said));
}

/**
 * A quick request's clock and its endings. Fed with what the engine tells about the call; `end` is called once, with
 * the reason and the line the voice says before hanging up.
 */
export function createQuickEnding(o: {
  locale: VoiceLocale;
  names?: string[];
  timers: RunTimers;
  /** Tasks the voice started that have not been answered yet. */
  pending: () => number;
  end: (reason: QuickEndReason, line: string) => void;
}) {
  const lines = QUICK_LINES[o.locale];
  let started = false;
  let over = false;
  let hearing = false;
  let speaking = false;
  let thinking = 0;
  let misses = 0;
  let turn = "";
  /** The voice's last turn ended with a question. */
  let asked = false;
  let cancel: (() => void) | undefined;

  const finish = (reason: QuickEndReason) => {
    if (over) return;
    over = true;
    cancel?.();
    cancel = undefined;
    o.end(reason, reason === "idle" ? "" : lines[reason]);
  };
  /** Waits for silence again, unless someone is talking or the voice is working out what to say. */
  const rearm = () => {
    cancel?.();
    cancel = undefined;
    if (over || !started || hearing || speaking || thinking > 0) return;
    cancel = o.timers.after(o.pending() > 0 ? QUICK_WAIT_MS : QUICK_IDLE_MS, () => finish("idle"));
  };

  return {
    /** The voice is up and listening: the clock starts. */
    ready() {
      started = true;
      rearm();
    },
    /** What the owner is saying right now; empty: it was dropped (noise, the voice's echo). */
    partial(text: string) {
      hearing = Boolean(text.trim());
      rearm();
    },
    /** The owner's words, heard as a whole. */
    heard(text: string) {
      hearing = false;
      if (isGoodbye(text, o.names, asked)) return finish("goodbye");
      rearm();
    },
    thinking(on: boolean) {
      thinking = Math.max(0, thinking + (on ? 1 : -1));
      rearm();
    },
    /** The call's model did not answer: the voice cannot go on. */
    failed() {
      finish("confused");
    },
    saying() {
      speaking = true;
      cancel?.();
      cancel = undefined;
    },
    said(text: string) {
      speaking = false;
      turn = `${turn} ${text}`.trim();
      rearm();
    },
    /** The voice's turn is over: twice in a row without understanding ends the request. */
    turnEnd() {
      speaking = false;
      if (turn) {
        misses = isMissed(turn) ? misses + 1 : 0;
        asked = turn.endsWith("?");
      }
      turn = "";
      if (misses >= QUICK_MISSES) return finish("confused");
      rearm();
    },
    /** A task started or answered: the wait changes. */
    tasks() {
      rearm();
    },
    get over() {
      return over;
    },
    stop() {
      over = true;
      cancel?.();
      cancel = undefined;
    },
  };
}

export type QuickEnding = ReturnType<typeof createQuickEnding>;
