import type { CSSProperties } from "react";
import { cx } from "../cx";

export type MediaKind = "image" | "video" | "audio" | "file";

const EXT: Record<string, MediaKind> = {};
for (const e of ["png", "jpg", "jpeg", "gif", "webp", "avif", "heic", "bmp", "svg"]) EXT[e] = "image";
for (const e of ["mp4", "mov", "m4v", "webm", "mkv", "avi"]) EXT[e] = "video";
for (const e of ["mp3", "m4a", "ogg", "oga", "opus", "wav", "flac", "aac"]) EXT[e] = "audio";

/** What a file is, from its MIME type or, failing that, its name's extension. */
export function mediaKindOf(mime?: string, name?: string): MediaKind {
  const top = mime?.split("/")[0];
  if (top === "image" || top === "video" || top === "audio") return top;
  const ext = name?.split(".").pop()?.toLowerCase();
  return (ext && EXT[ext]) || "file";
}

export interface MediaLoaderProps {
  kind: MediaKind;
  /** inline = just the moving icon, at text size; block (default) fills its box. */
  inline?: boolean;
  /** Icon size in pixels. */
  size?: number;
  className?: string;
  style?: CSSProperties;
}

/** A file that is still loading: an icon of its kind that moves, in place of a bare grey box or a word. */
export function MediaLoader({ kind, inline, size, className, style }: MediaLoaderProps) {
  const icon = <LoaderIcon kind={kind} size={size ?? (inline ? 14 : 30)} />;
  return (
    <span className={cx("apx-medialoader", inline && "is-inline", className)} style={style} aria-hidden="true">
      {icon}
    </span>
  );
}

function LoaderIcon({ kind, size }: { kind: MediaKind; size: number }) {
  return (
    <svg
      className={`apx-medialoader__icon is-${kind}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === "video" && (
        <>
          <circle cx="12" cy="12" r="9.5" opacity="0.25" />
          <circle className="apx-medialoader__arc" cx="12" cy="12" r="9.5" pathLength="100" />
          <path className="apx-medialoader__play" d="M10 8.5 15.5 12 10 15.5Z" fill="currentColor" />
        </>
      )}
      {kind === "image" && (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2.5" />
          <circle className="apx-medialoader__sun" cx="8.5" cy="9.5" r="1.6" />
          <path className="apx-medialoader__hills" d="m3.5 17.5 5-5 4 4 2.5-2.5 5.5 5.5" pathLength="100" />
        </>
      )}
      {kind === "audio" && (
        <>
          <path className="apx-medialoader__bar" d="M5 10v4" />
          <path className="apx-medialoader__bar" d="M9.5 6v12" />
          <path className="apx-medialoader__bar" d="M14.5 8v8" />
          <path className="apx-medialoader__bar" d="M19 10v4" />
        </>
      )}
      {kind === "file" && (
        <>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
          <path className="apx-medialoader__line" d="M8.5 12.5h7" />
          <path className="apx-medialoader__line" d="M8.5 15.5h7" />
          <path className="apx-medialoader__line" d="M8.5 18h4" />
        </>
      )}
    </svg>
  );
}
