// Typed hooks: watching an event and changing something are separate, and each change point has one owner.
// The only change point today is a turn's extra context.
import { conflict } from "../errors.ts";

export type ContextInput = {
  thread: { id: string; kind: string; title: string; project_id?: string | undefined };
  agent: { id: string; name: string };
  text: string;
};
type ContextProvider = { owner: string; name: string; fn: (input: ContextInput) => Promise<string | undefined> };

/** What a provider may add to one turn, at most. */
const CONTEXT_MAX = 4000;
const CONTEXT_DEADLINE_MS = 2000;

export function createHooks() {
  let provider: ContextProvider | undefined;
  return {
    /** Takes the turn-context point; another owner holding it is a conflict. */
    provideContext(p: ContextProvider): void {
      if (provider && provider.owner !== p.owner) throw conflict(`${provider.name} already adds context to turns`);
      provider = p;
    },
    release(owner: string): void {
      if (provider?.owner === owner) provider = undefined;
    },
    contextOwner: () => provider?.owner,
    /** The extra context for a turn, or nothing when there is no provider or it is too slow. */
    async context(input: ContextInput): Promise<{ from: string; text: string } | undefined> {
      const p = provider;
      if (!p) return undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<undefined>((r) => {
        timer = setTimeout(() => r(undefined), CONTEXT_DEADLINE_MS);
      });
      try {
        const text = await Promise.race([p.fn(input).catch(() => undefined), late]);
        return text ? { from: p.name, text: text.slice(0, CONTEXT_MAX) } : undefined;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export type Hooks = ReturnType<typeof createHooks>;
