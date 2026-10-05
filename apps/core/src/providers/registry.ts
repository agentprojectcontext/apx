// The model APIs our own loop can call: the built-in ones (config) plus what the owner adds or changes in the app
// (settings). Read on every use, so a change applies to the next call without a restart.
import type { ProviderConfig } from "../config.ts";
import type { Store } from "../domain/store.ts";

/** A provider as the owner set it; `removed` hides a built-in one. */
export type ProviderEntry = ProviderConfig & {
  label?: string | undefined;
  /** Which kind of service it is (gemini, groq, ollama…), for the card's look; not behaviour. */
  preset?: string | undefined;
  enabled?: boolean | undefined;
  removed?: boolean | undefined;
};

const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

export function providerRegistry(store: Store, builtIn: ProviderConfig[]) {
  const own = (): ProviderEntry[] => store.settings.read("providers");
  /** Built-ins first, each replaced by the owner's version of it; then the owner's new ones. */
  const all = (): Array<ProviderEntry & { builtin: boolean }> => {
    const mine = new Map(own().map((p) => [p.id, p]));
    // A saved label that is only the id is no name, and "custom" is no kind for a built-in: the built-in's own stay.
    const out: Array<ProviderEntry & { builtin: boolean }> = builtIn.map((b) => {
      const m = mine.get(b.id);
      const label = m?.label && m.label !== b.id ? m.label : b.label;
      const preset = m?.preset && m.preset !== "custom" ? m.preset : undefined;
      return { ...b, ...m, label, preset, builtin: true };
    });
    for (const p of mine.values()) if (!builtIn.some((b) => b.id === p.id)) out.push({ ...p, builtin: false });
    return out.filter((p) => !p.removed);
  };
  return {
    all,
    /** What can run now: present and not switched off. */
    active: (): ProviderConfig[] => all().filter((p) => p.enabled !== false),
    has: (id: string) => all().some((p) => p.id === id && p.enabled !== false),
    /** Saves the owner's version of one provider; null removes it (a built-in one is hidden instead). */
    set(id: string, p: Omit<ProviderEntry, "id"> | null): void {
      if (!ID.test(id)) throw new Error(`invalid provider id "${id}" (lowercase letters, digits and -)`);
      const rest = own().filter((x) => x.id !== id);
      const builtin = builtIn.some((b) => b.id === id);
      const next = p
        ? [...rest, { ...p, id }]
        : builtin
          ? [...rest, { ...(builtIn.find((b) => b.id === id) as ProviderConfig), removed: true }]
          : rest;
      store.settings.write("providers", next);
    },
  };
}

export type ProviderRegistry = ReturnType<typeof providerRegistry>;
