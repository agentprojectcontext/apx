import type { ReactNode } from "react";
import { cx } from "../cx";
import { Icons } from "../icons";
import { type MediaKind, MediaLoader } from "./MediaLoader";

export interface FileTileProps {
  /** The file's name: the open button's accessible name, and the label on a tile without a picture. */
  name: string;
  /** A short line under the name ("4 KB") on a tile without a picture. */
  meta?: string;
  /** A picture that fills the square (an image's URL). */
  src?: string;
  /** While the picture loads, a moving icon of this kind fills the square. */
  loading?: MediaKind;
  /** Icon for a file without a picture (a document by default). */
  icon?: ReactNode;
  /** Opens the file; the whole square is the button. */
  onOpen?: () => void;
  /** Icon buttons shown in the corner on hover or focus, and always on touch screens. */
  actions?: ReactNode;
  className?: string;
}

/** One file as a square: its picture, or an icon with its name and size. Lay several out with FileTileGrid. */
export function FileTile({ name, meta, src, loading, icon, onOpen, actions, className }: FileTileProps) {
  const picture = src !== undefined || loading !== undefined;
  return (
    <li className={cx("apx-filetile", picture && "is-picture", className)}>
      <button
        type="button"
        className="apx-filetile__open"
        title={name}
        aria-label={picture ? undefined : name}
        onClick={onOpen}
        disabled={!onOpen}
      >
        {src ? (
          <img src={src} alt={name} />
        ) : loading ? (
          <MediaLoader kind={loading} size={24} />
        ) : (
          <>
            <span className="apx-filetile__icon">{icon ?? <Icons.FileText size={22} />}</span>
            <span className="apx-filetile__name">{name}</span>
            {meta && <span className="apx-filetile__meta">{meta}</span>}
          </>
        )}
      </button>
      {actions && <div className="apx-filetile__actions">{actions}</div>}
    </li>
  );
}

export interface FileTileGridProps {
  /** Names the list for screen readers ("Attachments"). */
  label?: string;
  children: ReactNode;
  className?: string;
}

/** Same-size squares that wrap: as many across as the width holds, more rows below. */
export function FileTileGrid({ label, children, className }: FileTileGridProps) {
  return (
    <ul className={cx("apx-filetiles", className)} aria-label={label}>
      {children}
    </ul>
  );
}
