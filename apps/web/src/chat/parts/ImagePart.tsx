import type { Part } from "@apx/protocol";

const SAFE = /^(https?:|data:image\/)/i;

export function ImagePart({ part }: { part: Extract<Part, { type: "image" }> }) {
  if (!SAFE.test(part.url)) return null;
  return (
    <a className="imagepart" href={part.url} target="_blank" rel="noopener noreferrer">
      <img src={part.url} alt={part.alt} loading="lazy" />
    </a>
  );
}
