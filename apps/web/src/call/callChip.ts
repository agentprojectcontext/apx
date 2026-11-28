import type { Thread } from "@apx/protocol";

/** How a call's chat came by voice, for its header: a request said by name, and the phone it talked through. */
export function voiceChip(
  thread: Pick<Thread, "kind" | "call">,
): { key: "callChip.quick" | "callChip.quickFrom" | "callChip.fromDevice"; device?: string } | undefined {
  if (thread.kind !== "call" || !thread.call) return undefined;
  const { mode, device } = thread.call;
  if (mode === "quick") return device ? { key: "callChip.quickFrom", device } : { key: "callChip.quick" };
  return device ? { key: "callChip.fromDevice", device } : undefined;
}
