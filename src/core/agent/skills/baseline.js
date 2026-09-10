// Per-skill baselines: what "not about this skill" scores, so the inspector can
// tell a match from a loud description.
//
// The problem this solves, measured on a live index of 50 skills:
//
//   prompt: "creame una tarea para revisar el onboarding"
//     an emulator skill  0.579      a golf skill      0.529
//     a crypto skill     0.535      the TASK skill    0.427   ← the right answer, last
//
// Raw cosine is not comparable ACROSS skills. Each description sits at its own
// distance from ordinary language, so each has its own floor: a long, chatty
// description in the language the owner writes in scores ~0.55 against
// literally anything they type, while a short, precise one in another language
// tops out around 0.43 even on its own subject. The inspector's thresholds are
// single numbers applied to every skill, so those floors decide everything and
// the topic decides nothing. Three skills were injected into every turn on this
// install regardless of subject, and the skills that matched were never named.
//
// The signal is there — the emulator skill hits 0.838 on its own topic against
// its own ~0.55 floor. It is the OFFSET that has to go.
//
// So: measure each skill's floor once, at index time, against a fixed corpus of
// deliberately empty prompts, and store it. Scoring then asks how far ABOVE its
// own floor a skill is, in units of its own spread — a z-score. Same measure
// for every skill, so one threshold means the same thing for all of them.
//
// Cost is nothing at scoring time: the baseline is arithmetic over vectors the
// index already holds, computed when the index is built and read back with it.

import { cosineSim } from "#core/memory/embeddings.js";

/**
 * The background corpus: what a prompt looks like when it is about nothing.
 *
 * Chosen to be BLAND — greetings, filler, vague requests — because the floor we
 * want to measure is "how close is this description to ordinary language", and
 * a corpus with subjects in it would measure closeness to those subjects
 * instead. Half in each of the two languages this install is written in, so a
 * skill is not credited merely for being in the language the owner types.
 *
 * Fixed and versioned: changing it changes every stored baseline, so
 * BASELINE_VERSION below must move with it or old numbers survive into a new
 * scale and the thresholds quietly mean something else.
 */
export const BASELINE_CORPUS = Object.freeze([
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
]);

/** Bump whenever BASELINE_CORPUS or the maths below changes. */
export const BASELINE_VERSION = 1;

// A spread of zero would make every z infinite. It cannot happen with real
// vectors, but a degenerate embedder (all-zero output) would produce it, and an
// Infinity here becomes a skill injected into every turn forever.
const MIN_SD = 1e-6;

/**
 * Embed the background corpus once. Handed the SAME pinned embed options the
 * index build uses, so the baseline lives in the same vector space as the
 * descriptions it will be compared against — a baseline measured in another
 * space is worse than none.
 *
 * @param {(text: string) => Promise<{vector: number[]}>} embed
 */
export async function embedBaselineCorpus(embed) {
  const vectors = [];
  for (const text of BASELINE_CORPUS) {
    const out = await embed(text);
    if (Array.isArray(out?.vector) && out.vector.length) vectors.push(out.vector);
  }
  return vectors;
}

/**
 * Where this skill's description sits against ordinary language.
 *
 * @returns {{ mu: number, sd: number }} mean and spread of its similarity to
 *   the background — the floor to subtract and the unit to divide by.
 */
export function measureBaseline(descVector, corpusVectors) {
  if (!Array.isArray(descVector) || !descVector.length || !corpusVectors?.length) {
    // No baseline measurable → mu 0, sd 1 makes the z-score equal the raw
    // cosine. Degrades to the old behaviour for that one skill rather than
    // dropping it or letting it win.
    return { mu: 0, sd: 1 };
  }
  const sims = corpusVectors.map((v) => cosineSim(descVector, v));
  const mu = sims.reduce((a, b) => a + b, 0) / sims.length;
  const variance = sims.reduce((a, b) => a + (b - mu) ** 2, 0) / sims.length;
  return { mu, sd: Math.max(Math.sqrt(variance), MIN_SD) };
}

/**
 * How far above its own floor this skill is, for this prompt.
 *
 * The number the inspector ranks and thresholds on. An item indexed before
 * baselines existed has no mu/sd; it falls back to the raw cosine, which is
 * what the old code compared, so a stale index misranks rather than crashes.
 */
export function relevanceScore(rawSim, item) {
  const mu = typeof item?.base_mu === "number" ? item.base_mu : 0;
  const sd = typeof item?.base_sd === "number" && item.base_sd > 0 ? item.base_sd : 1;
  return (rawSim - mu) / sd;
}
