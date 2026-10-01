import { Globe } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../cx";
import { Button } from "./Button";

export interface LiveBrowserCardProps {
  /** Page URL shown in the footer. */
  url: string;
  /** Page title; falls back to the URL. */
  title?: ReactNode;
  /** One status line under the URL ("Roby is browsing", "Waiting for your password and 2FA"). */
  status?: ReactNode;
  /** warning = the agent needs you (handoff); neutral = informative. */
  statusTone?: "neutral" | "warning";
  /** Thumbnail image URL (screenshot data URL) or a custom node (screencast). Omit for a placeholder. */
  thumbnail?: string | ReactNode;
  /** Shows the "Live" badge with a red dot. */
  live?: boolean;
  liveLabel?: ReactNode;
  /** Primary action label ("Open live"). */
  actionLabel?: ReactNode;
  /** Click on the preview area. */
  onOpen?: () => void;
  /** Click on the primary action. */
  onAction?: () => void;
  className?: string;
}

/** Inline chat card for a browser task: live thumbnail, URL + status, and an action that opens the browser panel. */
export function LiveBrowserCard({
  url,
  title,
  status,
  statusTone = "neutral",
  thumbnail,
  live = false,
  liveLabel = "Live",
  actionLabel,
  onOpen,
  onAction,
  className,
}: LiveBrowserCardProps) {
  return (
    <div className={cx("apx-livebrowser", className)}>
      <button type="button" className="apx-livebrowser__preview" onClick={onOpen} aria-label={String(title ?? url)}>
        {typeof thumbnail === "string" ? (
          <img className="apx-livebrowser__img" src={thumbnail} alt="" draggable={false} />
        ) : (
          (thumbnail ?? (
            <span className="apx-livebrowser__placeholder">
              <Globe size={28} />
            </span>
          ))
        )}
        {live && (
          <span className="apx-livebrowser__badge">
            <span className="apx-livebrowser__dot" aria-hidden="true" />
            {liveLabel}
          </span>
        )}
      </button>
      <div className="apx-livebrowser__foot">
        <span className="apx-livebrowser__globe">
          <Globe size={16} />
        </span>
        <span className="apx-livebrowser__text">
          <span className="apx-livebrowser__title">{title ?? url}</span>
          {status ? (
            <span className={cx("apx-livebrowser__status", statusTone === "warning" && "is-warning")}>{status}</span>
          ) : (
            <span className="apx-livebrowser__status">{url}</span>
          )}
        </span>
        {actionLabel && (
          <Button size="sm" onClick={onAction}>
            {actionLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
