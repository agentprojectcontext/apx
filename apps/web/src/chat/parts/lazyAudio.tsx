import type { Part } from "@apx/protocol";
import { lazy, Suspense } from "react";

const Player = lazy(() => import("./AudioPart.tsx").then((m) => ({ default: m.AudioPart })));

/** The voice-note player, loaded with the first one on screen rather than with the panel. */
export function AudioPart({ part }: { part: Extract<Part, { type: "audio" }> }) {
  return (
    <Suspense fallback={null}>
      <Player part={part} />
    </Suspense>
  );
}
