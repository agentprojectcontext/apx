import type { Part } from "@apx/protocol";
import { Suspense } from "react";
import { AudioPlayer as Player } from "../../lazy.ts";

/** The voice-note player, loaded with the first one on screen rather than with the panel. */
export function AudioPart({ part }: { part: Extract<Part, { type: "audio" }> }) {
  return (
    <Suspense fallback={null}>
      <Player part={part} />
    </Suspense>
  );
}
