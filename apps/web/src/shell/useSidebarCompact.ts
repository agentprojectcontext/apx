import { useSyncExternalStore } from "react";
import { usePrefs } from "../data/prefs.ts";

/** Below this window height the sections' cards leave too little room for their rows: they become single rows. */
const COMPACT_BELOW_H = 760;

const subscribe = (fn: () => void) => {
  window.addEventListener("resize", fn);
  return () => window.removeEventListener("resize", fn);
};

/** The owner's choice (on by default), and on regardless in a window too short for the cards. */
export function useSidebarCompact(): boolean {
  const chosen = usePrefs((s) => s.sidebarCompact);
  const short = useSyncExternalStore(
    subscribe,
    () => window.innerHeight < COMPACT_BELOW_H,
    () => false,
  );
  return chosen || short;
}
