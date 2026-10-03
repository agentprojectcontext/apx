// Picks a turn's skills by meaning with the embedding engine. Each skill's vector and floor are kept in memory per
// engine and description; a skill added or edited is embedded on the next turn. A slow or missing engine never holds a
// turn: it goes on without picked skills (the catalog in the system prompt is always there).
import type { Part } from "@apx/protocol";
import { parseFrontmatter } from "../apc/frontmatter.ts";
import { memorySettings } from "../domain/memory-settings.ts";
import type { Store } from "../domain/store.ts";
import { errorMessage } from "../errors.ts";
import type { Log } from "../log.ts";
import type { Services } from "../services/registry.ts";
import { BASELINE, choose, cosine, type Floor, floorOf, PICK, relevance, skillsBlock } from "../skills/picker.ts";
import { readSkillFile, type Skill } from "../skills/skills.ts";

/** How long a turn waits for the vectors it needs; past this it goes on and they keep coming in the background. */
const WAIT_MS = 4000;
const BATCH = 32;

export type SkillPick = {
  /** For the turn's input; empty when nothing matched well enough. */
  block: string;
  /** For the chat: what was weighed and what went in. */
  part: Extract<Part, { type: "skills" }>;
};

type Known = { vector: Float32Array; floor: Floor };

const descOf = (s: Skill) => s.description.slice(0, 600);
const keyOf = (s: Skill) => `${s.name}\n${descOf(s)}`;

/** The skill the owner named with "/name": its body goes in whole; the chat shows it loaded, with no engine. */
export function askedPick(skill: Skill): SkillPick | undefined {
  try {
    const body = parseFrontmatter(readSkillFile(skill)).body;
    return {
      block: skillsBlock([{ name: skill.name, body }], []),
      part: { type: "skills", engine: "", loaded: [skill.name], hinted: [], scored: [] },
    };
  } catch {
    return undefined;
  }
}

export function createSkillPicker(deps: { store: Store; services: Services; log: Log }) {
  const { services, log } = deps;
  /** Per engine: the baseline prompts' vectors and each skill's (by name and description). */
  const spaces = new Map<string, { corpus: Float32Array[]; skills: Map<string, Known> }>();
  let filling: Promise<void> | undefined;

  const on = () => memorySettings(deps.store).skill_picker && services.embeddingModel() !== undefined;

  async function embedAll(texts: string[]): Promise<{ vectors: Float32Array[]; model: string }> {
    const vectors: Float32Array[] = [];
    let model = "";
    for (let i = 0; i < texts.length; i += BATCH) {
      const out = await services.embed(texts.slice(i, i + BATCH), AbortSignal.timeout(120_000));
      // Another engine answered halfway: vectors from two engines are never compared.
      if (model && out.model !== model) throw new Error("the embedding engine changed while indexing skills");
      model = out.model;
      vectors.push(...out.vectors);
    }
    return { vectors, model };
  }

  async function fill(skills: Skill[]): Promise<void> {
    const model = services.embeddingModel();
    if (!model) return;
    const space = spaces.get(model);
    const missing = skills.filter((s) => descOf(s).trim() && !space?.skills.has(keyOf(s)));
    if (space && !missing.length) return;
    const { vectors, model: used } = await embedAll([...(space ? [] : BASELINE), ...missing.map(descOf)]);
    // Another engine answered (the chosen one is down): nothing is kept, the next turn tries again.
    if (used !== model) return;
    const target = space ?? { corpus: vectors.slice(0, BASELINE.length), skills: new Map<string, Known>() };
    const own = space ? vectors : vectors.slice(BASELINE.length);
    missing.forEach((s, i) => {
      const v = own[i];
      if (v) target.skills.set(keyOf(s), { vector: v, floor: floorOf(v, target.corpus) });
    });
    spaces.set(model, target);
  }

  /** Vectors for these skills, shared by turns that arrive while they are being computed. */
  function ready(skills: Skill[]): Promise<void> {
    filling ??= fill(skills)
      .catch((err) => log.warn({ err: errorMessage(err, 200) }, "skills could not be indexed by meaning"))
      .finally(() => {
        filling = undefined;
      });
    return filling;
  }

  return {
    /** Indexes in the background (at start, so the first message does not wait). */
    warm(skills: Skill[]): void {
      if (on()) void ready(skills);
    },
    /** The skills this message calls for, or nothing (off, no engine, too short, or the engine too slow). */
    async pick(text: string, skills: Skill[]): Promise<SkillPick | undefined> {
      const prompt = text.trim();
      if (!on() || prompt.length < PICK.minPrompt || !skills.length) return undefined;
      try {
        const deadline = AbortSignal.timeout(WAIT_MS);
        const timeout = new Promise<void>((resolve) => deadline.addEventListener("abort", () => resolve()));
        await Promise.race([ready(skills), timeout]);
        const { vectors, model } = await services.embed([prompt.slice(0, 2000)], deadline);
        const query = vectors[0];
        const space = spaces.get(model);
        if (!query || !space) return undefined;
        const scored = skills
          .flatMap((s) => {
            const k = space.skills.get(keyOf(s));
            if (!k) return [];
            const sim = cosine(query, k.vector);
            return [{ name: s.name, sim, rel: relevance(sim, k.floor) }];
          })
          .sort((a, b) => b.rel - a.rel);
        if (!scored.length) return undefined;
        const { loaded, hinted } = choose(scored);
        const byName = new Map(skills.map((s) => [s.name, s]));
        const bodies = loaded.flatMap((name) => {
          const s = byName.get(name);
          try {
            return s ? [{ name, body: parseFrontmatter(readSkillFile(s)).body }] : [];
          } catch {
            return [];
          }
        });
        const named = hinted.flatMap((name) => {
          const s = byName.get(name);
          return s ? [{ name, description: s.description }] : [];
        });
        return {
          block: skillsBlock(bodies, named),
          part: {
            type: "skills",
            engine: model,
            loaded: bodies.map((b) => b.name),
            hinted,
            scored: scored.slice(0, PICK.keep).map((s) => ({ name: s.name, sim: Math.round(s.sim * 1000) / 1000 })),
          },
        };
      } catch (err) {
        log.warn({ err: errorMessage(err, 200) }, "skills by meaning skipped this turn");
        return undefined;
      }
    },
  };
}

export type SkillPicker = ReturnType<typeof createSkillPicker>;
