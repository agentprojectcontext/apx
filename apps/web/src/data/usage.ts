// The usage store every usage view reads: the core's system.usage plus the desktop app's processes, polled only
// while a view is mounted (see createUsagePoller).
import { useEffect } from "react";
import { client } from "./client.ts";
import { createStore, useSlice } from "./createStore.ts";
import { createUsagePoller, type Snapshot, type Watch } from "./usageModel.ts";

const usage = createStore<Snapshot>({ detail: false });

const poller = createUsagePoller({
  read: async (detail) => {
    const [u, desktop] = await Promise.all([
      client.call("system.usage", { disk: detail }),
      detail ? window.apxDesktop?.memory?.().catch(() => undefined) : undefined,
    ]);
    // A light read keeps the last detail (home sizes, processes) rather than blanking an open view between reads.
    const prev = usage.get();
    return {
      usage: u.home || !prev.usage?.home ? u : { ...u, home: prev.usage.home },
      ...(desktop ? { desktop } : prev.desktop ? { desktop: prev.desktop } : {}),
    };
  },
  onSnapshot: (s) => usage.set({ error: undefined, ...s }),
});

/**
 * The latest usage, read while this view is mounted: `every` ms between reads, `detail` for disk by part and
 * processes. Without a watch it only shows what others read.
 */
export function useUsage(w: Watch | undefined): Snapshot {
  const detail = w?.detail;
  const every = w?.every;
  useEffect(
    () => (every === undefined ? undefined : poller.watch({ detail: detail === true, every })),
    [detail, every],
  );
  return useSlice(usage, (s) => s);
}

export const refreshUsage = () => poller.refresh();
