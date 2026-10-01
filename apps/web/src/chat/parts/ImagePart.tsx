import type { Part } from "@apx/protocol";
import { Skeleton } from "@apx/ui";
import { useMediaUrl } from "./useMediaUrl.ts";

const SAFE = /^(https?:|data:image\/)/i;

/** An image from the web (only http(s) or inline data) or one APX made (loaded through media.get). */
export function ImagePart({ part }: { part: Extract<Part, { type: "image" }> }) {
  const own = useMediaUrl(part.media_id);
  const src = part.media_id ? own : part.url && SAFE.test(part.url) ? part.url : undefined;
  if (part.media_id && !own) return <Skeleton className="imagepart imagepart--loading" />;
  if (!src) return null;
  return (
    <a className="imagepart" href={src} target="_blank" rel="noopener noreferrer">
      <img src={src} alt={part.alt} loading="lazy" />
    </a>
  );
}
