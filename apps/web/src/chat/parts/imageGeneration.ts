import type { Part, RunState } from "@apx/protocol";

export function isGeneratingImage(part: Part, state: RunState | undefined): boolean {
  return (
    (state === "working" || state === "submitted" || state === "queued") &&
    part.type === "tool" &&
    part.tool === "make_image" &&
    part.status === "running"
  );
}
