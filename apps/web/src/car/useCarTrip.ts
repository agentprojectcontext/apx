// The current trip as the panel shows it: read once, and again whenever the core says it changed.
import type { CarAction, CarAlert, CarTripView } from "@apx/protocol";
import { useCallback, useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { watchEvents } from "../data/live.ts";

export function useCarTrip(): {
  view: CarTripView | undefined;
  failed: boolean;
  reload: () => void;
} {
  const [view, setView] = useState<CarTripView>();
  const [failed, setFailed] = useState(false);
  const reload = useCallback(() => {
    void client.call("car.trip", {}).then(
      (v) => {
        setView(v);
        setFailed(false);
      },
      () => setFailed(true),
    );
  }, []);
  useEffect(() => {
    reload();
    return watchEvents((ev) => {
      if (ev.type === "car.updated") reload();
    });
  }, [reload]);
  return { view, failed, reload };
}

/**
 * Answers an offer. Going there opens Google Maps first, inside the click, so the browser lets the tab open.
 */
export async function answerOffer(alert: CarAlert, action: CarAction): Promise<void> {
  const url = action === "navigate" ? alert.navigate_url : action === "add_stop" ? alert.add_stop_url : undefined;
  if (url) window.open(url, "_blank", "noopener,noreferrer");
  await client.call("car.answer", { alert_id: alert.id, action });
}
