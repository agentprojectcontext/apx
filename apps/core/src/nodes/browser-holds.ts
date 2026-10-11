// The tabs each running turn uses, told to whatever runs the browser so it never closes them for being idle while
// the turn lasts. The turn's end lets them go.

/** Where the holds go: the desktop node or the core's headless browser. `key` changes when that browser does. */
export type HoldTarget = { key: string; send: (run: string, tabs: string[]) => Promise<unknown> };

/** Ended runs remembered, so a call answering after its turn ended does not hold a tab again. */
const ENDED_MAX = 500;

export function createBrowserHolds(target: () => HoldTarget | undefined) {
  const runs = new Map<string, Set<string>>();
  const ended = new Set<string>();
  let told: string | undefined;
  const tell = (t: HoldTarget, run: string, tabs: string[]) => void t.send(run, tabs).catch(() => {});
  return {
    hold(run: string, tab: string): void {
      if (ended.has(run)) return;
      const t = target();
      if (!t) return;
      const tabs = runs.get(run) ?? new Set<string>();
      const fresh = !tabs.has(tab);
      tabs.add(tab);
      runs.set(run, tabs);
      // A browser that came up since (the app reconnected) knows no holds: it hears all of them again.
      if (told !== t.key) {
        told = t.key;
        for (const [r, held] of runs) tell(t, r, [...held]);
      } else if (fresh) tell(t, run, [...tabs]);
    },
    end(run: string): void {
      ended.add(run);
      if (ended.size > ENDED_MAX) ended.delete(ended.values().next().value as string);
      if (!runs.delete(run)) return;
      const t = target();
      if (t) tell(t, run, []);
    },
  };
}
