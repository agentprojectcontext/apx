// Release news worth acting on: what a release lets the super-agent do for this owner. Each entry is told once, and
// only to an owner it applies to. See rules/DECISIONS.md#d-117
import type { Store } from "../domain/store.ts";

/** What an entry may ask about this install before it is told. */
export type NewsFacts = {
  /** The owner's widgets and apps, in every project. */
  artifacts: number;
};

export type NewsAction = {
  /** The button, in the owner's language (English for any other). */
  label: { en: string; es: string };
  /** What pressing it says to the super-agent, as the owner's words. */
  prompt: string;
};

export type NewsEntry = {
  /** Stable and short: it travels in a channel button's id (64 bytes on Telegram). */
  id: string;
  /** The first release that has it. */
  since: string;
  /** A few words, for the list and when several are told at once. */
  title: string;
  applies: (facts: NewsFacts) => boolean;
  /** What changed, for the super-agent to tell in its own words (English; the model writes the owner's language). */
  text: string;
  actions: NewsAction[];
};

export const NEWS: readonly NewsEntry[] = [
  {
    id: "artifacts-kit",
    since: "2.8.0",
    title: "Widgets remember and can become apps",
    applies: (f) => f.artifacts > 0,
    text:
      "Widgets now remember their last reading, so they open with data at once; they can stay live while hidden; " +
      "they have a new look (aurora); and one can become an app with its own records.",
    actions: [
      {
        label: { en: "Update my widgets", es: "Actualizar mis widgets" },
        prompt:
          "Review my widgets and offer to update them to the new APX Kit design and memory (the last reading kept, " +
          "live where it helps). Tell me which ones you would change and how before changing them; hand the work to " +
          "my agents if you prefer.",
      },
      {
        label: { en: "Make one an app", es: "Convertir uno en app" },
        prompt:
          "Look at my widgets and suggest which one would work better as an app (keeping records, its own screens). " +
          "Say why, and wait for my yes before building it.",
      },
    ],
  },
];

export const newsFacts = (store: Store): NewsFacts => ({ artifacts: store.surfaces.list().length });

/** The action a channel button stands for. */
export const newsAction = (entryId: string, index: number): NewsAction | undefined =>
  NEWS.find((e) => e.id === entryId)?.actions[index];
