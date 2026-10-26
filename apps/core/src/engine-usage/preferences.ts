import type { EngineUsageReport } from "@apx/protocol";
import type { Store } from "../domain/store.ts";
import { cachedEngineUsage } from "./cache.ts";

type Preferences = Record<string, boolean>;
const canonical = (id: string) => (id === "acp:opencode" ? "opencode" : id);

/** Opting out stops probes as well as hiding cached account metadata. */
export function usagePreferences(
  settings: Store["settings"],
  makeReader: (enabled: (id: string) => boolean) => () => Promise<EngineUsageReport>,
  linked: () => boolean,
) {
  const get = () => ({ engines: { codex: linked(), ...settings.read("engine_usage") } });
  const enabled = (prefs: Preferences, id: string) => prefs[canonical(id)] === true;
  let key: string | undefined;
  let read: (() => Promise<EngineUsageReport>) | undefined;
  return {
    get,
    set(id: string, on: boolean) {
      settings.write("engine_usage", { ...settings.read("engine_usage"), [canonical(id)]: on });
      return get();
    },
    async read() {
      const prefs = get().engines;
      const nextKey = JSON.stringify(prefs);
      if (!read || key !== nextKey) {
        key = nextKey;
        read = cachedEngineUsage(makeReader((id) => enabled(prefs, id)));
      }
      const report = await read();
      const current = get().engines;
      return { ...report, engines: report.engines.filter((engine) => enabled(current, engine.id)) };
    },
  };
}
