// Skills by meaning: each message is compared with every skill's description, and the ones that clearly match go into
// that turn's input (the best one whole, a couple more by name). The numbers live here; the vectors in skill-index.ts.

/**
 * Bars on relevance: how far a skill stands above its own floor (its similarity to ordinary, subject-less prompts), in
 * units of its own spread. Raw similarity is not comparable across skills: a long, chatty description scores high
 * against anything. See DECISIONS.md#d-028
 */
export const PICK = {
  /** At or above: the body goes in whole. */
  load: 3.0,
  /** At or above: named, with its one-line description. */
  hint: 2.2,
  /** The one loaded must beat the runner-up by this much (a tie of mediocre matches loads nothing). */
  margin: 0.4,
  /** Under this raw similarity a skill is unrelated, however far above its floor. */
  floor: 0.3,
  maxLoaded: 1,
  maxHints: 2,
  /** Shorter messages ("ok", "hola") are not compared. */
  minPrompt: 8,
  /** A loaded body past this is cut (load_skill gives the rest). */
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

/** Which skills go in: `loaded` whole, `hinted` by name. `scored` comes sorted by relevance, best first. */
export function choose(scored: Scored[]): { loaded: string[]; hinted: string[] } {
  const eligible = scored.filter((s) => s.sim >= PICK.floor);
  const [top, runner] = eligible;
  if (!top || top.rel < PICK.hint) return { loaded: [], hinted: [] };
  const loaded =
    top.rel >= PICK.load && top.rel - (runner?.rel ?? 0) >= PICK.margin
      ? eligible
          .filter((s) => s.rel >= PICK.load)
          .slice(0, PICK.maxLoaded)
          .map((s) => s.name)
      : [];
  const hinted = eligible
    .filter((s) => s.rel >= PICK.hint && !loaded.includes(s.name))
    .slice(0, PICK.maxHints)
    .map((s) => s.name);
  return { loaded, hinted };
}

/**
 * What the model reads. A skill is said to be a capability it has: a model told a skill is "possibly relevant" skips
 * it and answers from memory that it cannot do the thing. No scores here; they mean nothing to a model.
 */
export function skillsBlock(
  loaded: Array<{ name: string; body: string }>,
  hinted: Array<{ name: string; description: string }>,
): string {
  if (!loaded.length && !hinted.length) return "";
  const lines = [
    "A skill is a capability you HAVE: it is installed here and its body says how to use it. These matched this message.",
  ];
  for (const s of loaded) {
    const body =
      s.body.length > PICK.bodyCap ? `${s.body.slice(0, PICK.bodyCap)}\n\n…(cut; load_skill gives the rest)` : s.body;
    lines.push("", `### Loaded: ${s.name}`, body.trim());
  }
  if (hinted.length) {
    lines.push("", "Installed and relevant; read before you answer:");
    for (const s of hinted) lines.push(`- ${s.name}: ${s.description.replace(/\s+/g, " ").trim()}`);
    lines.push(
      "If the message asks for what one of these does, call load_skill with its name BEFORE answering. Never say you cannot do something a skill here covers without reading it first.",
    );
  }
  return lines.join("\n");
}
