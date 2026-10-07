import { useEffect } from "react";
import { client } from "./client.ts";
import { createStore, useSlice } from "./createStore.ts";
import { usePrefs } from "./prefs.ts";

const fromCore = createStore({ name: "", asked: false });

/** How the panel names the owner in third person ("Alex assigned it"): this device's name, else the core's, else "". */
export function useOwnerName(): string {
  const local = usePrefs((s) => s.displayName);
  const core = useSlice(fromCore, (s) => s.name);
  useEffect(() => {
    if (local || fromCore.get().asked) return;
    fromCore.set({ asked: true });
    void client
      .call("owner.get", {})
      .then((o) => fromCore.set({ name: o.name.trim() }))
      .catch(() => fromCore.set({ asked: false }));
  }, [local]);
  return local || core;
}
