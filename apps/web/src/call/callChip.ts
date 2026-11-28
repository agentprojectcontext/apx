import type { Thread } from "@apx/protocol";

/** Which phone a call's chat talked through, for its header. Its name already says when it was a voice request. */
export function voiceChip(
  thread: Pick<Thread, "kind" | "call">,
): { key: "callChip.fromDevice"; device: string } | undefined {
  const device = thread.kind === "call" ? thread.call?.device : undefined;
  return device ? { key: "callChip.fromDevice", device } : undefined;
}
