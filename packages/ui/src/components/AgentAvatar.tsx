import type { CSSProperties } from "react";
import { BLOB_VIEWBOX, BLOBS, type BlobName } from "../blobs/catalog";
import { hashSeed } from "../blobs/seed";
import { cx } from "../cx";
import { Avatar } from "./Avatar";

export interface AgentAvatarProps {
  /** Agent name (alt text, and the fallback initials when `blob` is missing or unknown). */
  name: string;
  /** Blob from the APX catalog: "menta", "noche", "kiwi", "coral", "zafiro", "amatista"… (see BLOB_NAMES). */
  blob?: BlobName | (string & {});
  /** Pixel size (default 32). Blobs read well from 16 to 64. */
  size?: number;
  /** Bob, look around and blink. Off for dense lists or pickers. Respects prefers-reduced-motion. */
  animated?: boolean;
  /** Presence dot. */
  status?: "online" | "busy" | "away" | "offline";
  /** Spoken name of `status` (translations); defaults to the status id. */
  statusLabel?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * The one avatar for agents — APX's silicone blobs with SVG eyes that look around and blink,
 * each agent desynced by a name-derived delay. Unknown blob → initials Avatar.
 */
export function AgentAvatar({
  name,
  blob,
  size = 32,
  animated = true,
  status,
  statusLabel,
  className,
  style,
}: AgentAvatarProps) {
  const p = blob ? (BLOBS as Record<string, (typeof BLOBS)[BlobName]>)[blob] : undefined;
  if (!p)
    return (
      <Avatar name={name} size={size} status={status} statusLabel={statusLabel} className={className} style={style} />
    );
  const delay = `-${(hashSeed(name) % 40) / 10}s`;
  return (
    <span
      className={cx("apx-blob", animated && "apx-blob--anim", className)}
      style={{ width: size, height: size, ["--apx-blob-delay" as string]: delay, ...style }}
      role="img"
      aria-label={status ? `${name} (${statusLabel ?? status})` : name}
    >
      <span className="apx-blob__bob">
        <img className="apx-blob__body" src={p.src} alt="" draggable={false} />
        <svg className="apx-blob__eyes" viewBox={`0 0 ${BLOB_VIEWBOX} ${BLOB_VIEWBOX}`} aria-hidden="true">
          <g className="apx-blob__look">
            <g className="apx-blob__blink">
              {p.eyes.map((e) => (
                <rect key={`${e.x},${e.y}`} x={e.x} y={e.y} width={e.w} height={e.h} rx={e.rx} fill={p.eyeColor} />
              ))}
            </g>
          </g>
        </svg>
      </span>
      {status && <span className={cx("apx-avatar__status", `is-${status}`)} />}
    </span>
  );
}
