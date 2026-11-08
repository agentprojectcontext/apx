import { useEffect } from "react";
import { prefs, setPrefs, usePrefs } from "../data/prefs.ts";

/** Opens or closes an Inbox row for good: what the owner opened stays open on this device, the rest stays closed. */
function setRowOpen(key: string, open: boolean): void {
  const now = prefs.get().inboxOpen;
  if (open === now.includes(key)) return;
  setPrefs({ inboxOpen: open ? [...now, key].slice(-500) : now.filter((k) => k !== key) });
}

/**
 * Whether an Inbox row is open (closed until the owner opens it, remembered after). `reveal`: the chat on screen is
 * inside it, so it opens, and stays so.
 */
export function useOpenRow(key: string, reveal = false): [boolean, (open: boolean) => void] {
  const open = usePrefs((s) => s.inboxOpen.includes(key));
  useEffect(() => {
    if (reveal) setRowOpen(key, true);
  }, [reveal, key]);
  return [open || reveal, (next) => setRowOpen(key, next)];
}
