import { useEffect, useRef } from "react";
import { subscribeLive, type LiveEvent } from "../lib/live";

/**
 * React binding for the live feed (lib/live.ts): call `onEvents` whenever the
 * daemon reports that a conversation moved.
 *
 * The callback is held in a ref, so a screen that rebuilds it every render —
 * most of them do — does not resubscribe on every render. The socket itself is
 * shared by the whole panel and outlives any one component.
 */
export function useLiveMessages(onEvents: (events: LiveEvent[]) => void): void {
  const latest = useRef(onEvents);
  latest.current = onEvents;
  useEffect(() => subscribeLive((events) => latest.current(events)), []);
}
