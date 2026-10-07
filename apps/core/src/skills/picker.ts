// Skills by meaning: each message is compared with every skill's description, and the ones that clearly match are named
// in that turn's input for the agent to load. Only "/name" puts a body in whole. The numbers live here.

/**
 * Bars on relevance: how far a skill stands above its own floor (its similarity to ordinary, subject-less prompts), in
 * units of its own spread. Raw similarity is not comparable across skills: a long, chatty description scores high
 * against anything. See DECISIONS.md#d-028
 */
export const PICK = {
  /** At or above: named, with its one-line description, for the agent to load. */
  hint: 2.2,
  /** Under this raw similarity a skill is unrelated, however far above its floor. */
  floor: 0.3,
  /** At or above this raw similarity a named skill is recommended strongly; the agent still decides. */
  strong: 0.6,
  maxHints: 3,
  /** Shorter messages ("ok", "hola") are not compared. */
  minPrompt: 8,
  /** A body asked for with "/name" past this is cut (load_skill gives the rest). */
  bodyCap: 6000,
  /** How many of the closest are kept for the chat to show. */
  keep: 5,
} as const;

/** What a prompt about nothing looks like, in both languages APX speaks: each skill's floor is measured on these. */
export const BASELINE = [
  "hola, como va todo",
  "necesito que me ayudes con una cosa",
  "dale, hacelo por favor",
  "que opinas de esto",
  "hoy tengo que terminar varias cosas",
  "me podes explicar como funciona",
  "gracias, despues lo vemos",
  "esperá que te paso el detalle",
  "hello, how are you doing today",
  "I need help with something",
  "please go ahead and do it",
  "what do you think about this",
  "I have a few things to finish",
  "can you explain how this works",
  "thanks, we can look at it later",
  "hold on, I will send you the details",
] as const;

/**
 * "/name rest…" where name is one of these skills: the owner asked for it by name (the chat's / menu, a channel
 * command). It goes in whole whatever the engine says, and with no engine at all.
 */
export function askedSkill<S extends { name: string }>(text: string, skills: S[]): S | undefined {
  const m = /^\/([a-zA-Z0-9][a-zA-Z0-9_.-]{0,63})(?:@\w+)?(?:\s|$)/.exec(text.trimStart());
  const name = m?.[1]?.toLowerCase();
  return name ? skills.find((s) => s.name.toLowerCase() === name) : undefined;
}

export type Floor = { mu: number; sd: number };
export type Scored = { name: string; sim: number; rel: number };

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** A skill's floor: mean and spread of its similarity to the baseline prompts. */
export function floorOf(desc: Float32Array, corpus: Float32Array[]): Floor {
  if (!corpus.length) return { mu: 0, sd: 1 };
  const sims = corpus.map((v) => cosine(desc, v));
  const mu = sims.reduce((a, b) => a + b, 0) / sims.length;
  const variance = sims.reduce((a, b) => a + (b - mu) ** 2, 0) / sims.length;
  // A zero spread (a degenerate engine) would make one skill win every turn.
  return { mu, sd: Math.max(Math.sqrt(variance), 1e-6) };
}

export const relevance = (sim: number, f: Floor) => (sim - f.mu) / f.sd;

/**
 * Which skills are named: `strong` ones first, then `hinted`. None goes in whole: a match by meaning is a guess, and a
 * wrong body costs context and misleads. `scored` comes sorted by relevance, best first. See DECISIONS.md#d-051
 */
export function choose(scored: Scored[]): { strong: string[]; hinted: string[] } {
  const named = scored.filter((s) => s.sim >= PICK.floor && s.rel >= PICK.hint).slice(0, PICK.maxHints);
  return {
    strong: named.filter((s) => s.sim >= PICK.strong).map((s) => s.name),
    hinted: named.filter((s) => s.sim < PICK.strong).map((s) => s.name),
  };
}

/**
 * What the model reads. A skill is said to be a capability it has: a model told a skill is "possibly relevant" skips
 * it and answers from memory that it cannot do the thing. No scores here; they mean nothing to a model.
 */
export function skillsBlock(
  loaded: Array<{ name: string; body: string }>,
  named: Array<{ name: string; description: string; strong?: boolean }>,
): string {
  if (!loaded.length && !named.length) return "";
  const lines = [
    "A skill is a capability you HAVE: it is installed here and its body says how to use it. These matched this message.",
  ];
  for (const s of loaded) {
    const body =
      s.body.length > PICK.bodyCap ? `${s.body.slice(0, PICK.bodyCap)}\n\n…(cut; load_skill gives the rest)` : s.body;
    lines.push("", `### Loaded: ${s.name}`, body.trim());
  }
  const strong = named.filter((s) => s.strong);
  const rest = named.filter((s) => !s.strong);
  const list = (group: typeof named) => group.map((s) => `- ${s.name}: ${s.description.replace(/\s+/g, " ").trim()}`);
  if (strong.length) lines.push("", "Very close to this message; most likely what it needs:", ...list(strong));
  if (rest.length) lines.push("", "Installed and matching this message:", ...list(rest));
  if (named.length) {
    lines.push(
      "Judge each against the message: if it asks for what a skill does, call load_skill with its name BEFORE answering; if it is about something else, ignore it. Never say you cannot do something a skill here covers without reading it first.",
    );
  }
  return lines.join("\n");
}
