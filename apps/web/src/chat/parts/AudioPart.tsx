import type { Part } from "@apx/protocol";
import { useMediaUrl } from "./useMediaUrl.ts";

/** Speech APX made, with its transcript under it when there is one. */
export function AudioPart({ part }: { part: Extract<Part, { type: "audio" }> }) {
  const src = useMediaUrl(part.media_id);
  return (
    <div className="audiopart">
      {/* biome-ignore lint/a11y/useMediaCaption: the transcript is shown right below. */}
      {src && <audio controls src={src} />}
      {part.transcript && <p className="audiopart__text">{part.transcript}</p>}
    </div>
  );
}
