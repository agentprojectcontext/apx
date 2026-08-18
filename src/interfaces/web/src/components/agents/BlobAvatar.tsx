import type { CSSProperties } from "react";
import { cn } from "../../lib/cn";
import { BLOB_PRESETS, BLOB_VIEWBOX } from "./blobPresets";

// Deterministic 0..-3.9s delay from a seed (agent slug), so a list of blobs
// doesn't blink/look in lockstep.
function delayFor(seed?: string): string {
  if (!seed) return "0s";
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `-${(h % 40) / 10}s`;
}

/**
 * Animated silicone-blob avatar: a transparent body PNG with rounded-rect eyes
 * drawn on top in an overlaid SVG. The whole thing bobs+tilts; the eyes look
 * around and blink on their own nested groups (see .blobav* in styles.css).
 * Set `animated={false}` for a still version (icon picker grid).
 */
export function BlobAvatar({
  preset,
  size = 36,
  animated = true,
  seed,
  className,
}: {
  preset: string;
  size?: number;
  animated?: boolean;
  seed?: string;
  className?: string;
}) {
  const p = BLOB_PRESETS[preset];
  if (!p) return null;
  const style: CSSProperties = { width: size, height: size, ["--bl-d" as string]: delayFor(seed) };
  return (
    <span className={cn("blobav", animated && "blobav-anim", className)} style={style}>
      <img className="blobav-body" src={p.src} alt="" draggable={false} />
      <svg className="blobav-eyes-svg" viewBox={`0 0 ${BLOB_VIEWBOX} ${BLOB_VIEWBOX}`} aria-hidden="true">
        <g className="blobav-look">
          <g className="blobav-eyes">
            {p.eyes.map((e, i) => (
              <rect key={i} x={e.x} y={e.y} width={e.w} height={e.h} rx={e.rx} fill={p.eyeColor} />
            ))}
          </g>
        </g>
      </svg>
    </span>
  );
}
