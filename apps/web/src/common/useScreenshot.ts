import { useEffect, useState } from "react";
import { screenshot } from "../data/actions.ts";

/** Polls browser.screenshot for a tab while `enabled`; keeps the last good frame on errors. */
export function useScreenshot(
  tab: string | undefined,
  intervalMs: number,
  enabled: boolean,
): { src: string | undefined; error: boolean } {
  const [frame, setFrame] = useState<{ tab: string; src: string }>();
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!tab || !enabled) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const src = await screenshot(tab);
        if (!alive) return;
        setFrame({ tab, src });
        setError(false);
      } catch {
        if (alive) setError(true);
      }
      if (alive) timer = setTimeout(tick, intervalMs);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [tab, intervalMs, enabled]);

  return { src: frame && frame.tab === tab ? frame.src : undefined, error };
}
