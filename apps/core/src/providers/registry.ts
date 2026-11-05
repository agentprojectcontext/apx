// The model APIs our own loop can call: the built-in ones (config) plus what the owner adds or changes in the app
// (settings). Read on every use, so a change applies to the next call without a restart.
import type { ProviderConfig } from "../config.ts";
import type { Store } from "../domain/store.ts";
import { loopbackServer } from "./local-models.ts";

/** A provider as the owner set it; `removed` hides a built-in one. */
export type ProviderEntry = ProviderConfig & {
  label?: string | undefined;
  /** Which kind of service it is (gemini, groq, ollama…), for the card's look; not behaviour. */
  preset?: string | undefined;
  enabled?: boolean | undefined;
  removed?: boolean | undefined;
};

const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** Model apps found on this computer (local-models.ts); none in a registry without them. */
type Found = { providers(): ProviderConfig[]; serves(url: string): boolean };

export function providerRegistry(store: Store, builtIn: ProviderConfig[], found?: Found) {
  const own = (): ProviderEntry[] => store.settings.read("providers");
  /**
   * Built-ins and found apps, an app the owner already set up at its address left out: that entry is the app. One of
   * theirs elsewhere under the app's id keeps it; the app found here is then `<id>-local`.
   */
  const base = (mine: ProviderEntry[]): ProviderConfig[] => {
    const taken = [...builtIn, ...mine.filter((p) => !p.removed)];
    const apps = (found?.providers() ?? [])
      .filter((f) => !taken.some((p) => p.id !== f.id && sameServer(p.base_url, f.base_url)))
      .map((f) =>
        taken.some((p) => p.id === f.id && !sameServer(p.base_url, f.base_url)) ? { ...f, id: `${f.id}-local` } : f,
      )
      .filter((f) => !builtIn.some((b) => b.id === f.id));
    return [...builtIn, ...apps];
  };
  /** Built-ins first, each replaced by the owner's version of it; then the owner's new ones. */
  const all = (): Array<ProviderEntry & { builtin: boolean }> => {
    const list = own();
    const mine = new Map(list.map((p) => [p.id, p]));
    const local = (p: ProviderConfig) => ({ local: found?.serves(p.base_url) ? true : undefined });
    // A saved label that is only the id is no name, and "custom" is no kind for a built-in: the built-in's own stay.
    const out: Array<ProviderEntry & { builtin: boolean }> = base(list).map((b) => {
      const m = mine.get(b.id);
      const label = m?.label && m.label !== b.id ? m.label : b.label;
      const preset = m?.preset && m.preset !== "custom" ? m.preset : undefined;
      const builtin = builtIn.some((x) => x.id === b.id);
      return { ...b, ...m, label, preset, builtin, ...local({ ...b, ...m }) };
    });
    for (const p of mine.values()) if (!out.some((b) => b.id === p.id)) out.push({ ...p, builtin: false, ...local(p) });
    return out.filter((p) => !p.removed);
  };
  return {
    all,
    /** What can run now: present and not switched off. */
    active: (): ProviderConfig[] => all().filter((p) => p.enabled !== false),
    has: (id: string) => all().some((p) => p.id === id && p.enabled !== false),
    /** Saves the owner's version of one provider; null removes it (a built-in or found one is hidden instead). */
    set(id: string, p: Omit<ProviderEntry, "id"> | null): void {
      if (!ID.test(id)) throw new Error(`invalid provider id "${id}" (lowercase letters, digits and -)`);
      const list = own();
      const rest = list.filter((x) => x.id !== id);
      const given = base(list).find((b) => b.id === id);
      const next = p ? [...rest, { ...p, id }] : given ? [...rest, { ...given, removed: true }] : rest;
      store.settings.write("providers", next);
    },
  };
}

const sameServer = (a: string, b: string) => {
  const s = loopbackServer(a);
  return s !== undefined && s === loopbackServer(b);
};

export type ProviderRegistry = ReturnType<typeof providerRegistry>;
