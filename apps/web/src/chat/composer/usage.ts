import type { Result } from "@apx/protocol";
import { useEffect, useState } from "react";
import { client } from "../../data/client.ts";

type Summary = Result<"usage.summary">;

// The composer and the Usage panel ask together: one request per chat and stamp.
const asked = new Map<string, { stamp: string; summary: Promise<Summary> }>();

function summaryOf(thread: string, stamp: string): Promise<Summary> {
  const hit = asked.get(thread);
  if (hit?.stamp === stamp) return hit.summary;
  const summary = client.call("usage.summary", { thread });
  summary.catch(() => asked.get(thread)?.summary === summary && asked.delete(thread));
  asked.set(thread, { stamp, summary });
  return summary;
}

/** The chat's usage as the core counts it, over every run it kept; the last figures stay while newer ones load. */
export function useThreadUsage(thread: string | undefined, stamp: string): Summary | undefined {
  const [seen, setSeen] = useState<{ thread: string; summary: Summary }>();
  useEffect(() => {
    if (!thread) return;
    let live = true;
    summaryOf(thread, stamp)
      .then((summary) => live && setSeen({ thread, summary }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [thread, stamp]);
  return seen && seen.thread === thread ? seen.summary : undefined;
}
