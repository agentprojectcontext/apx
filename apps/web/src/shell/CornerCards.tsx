import "../styles/corner.css";
import { Button, IconButton, Icons, ProjectTile } from "@apx/ui";
import type { CSSProperties } from "react";
import { useT } from "../i18n/index.ts";
import { type Notice, useNotices } from "./notices.tsx";

/**
 * The notices as a small deck (the compact sidebar): only the first that still applies shows; up to two more peek out
 * behind it as edges and the next comes forward when it is closed. At the foot of the sidebar; floating beside it when
 * the sidebar is a rail, away from the composer.
 */
export function CornerCards({ floating = false }: { floating?: boolean }) {
  const t = useT();
  const notices = useNotices();
  const front = notices[0];
  if (!front) return null;
  const behind = Math.min(notices.length - 1, 2);
  return (
    <aside
      className={floating ? "corner is-floating" : "corner"}
      aria-label={t("corner.label")}
      style={{ "--corner-peek": `${behind * 8}px` } as CSSProperties}
    >
      {/* The cards waiting behind show only as edges: nothing in them to read or reach until they come forward. */}
      {Array.from({ length: behind }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the plates are interchangeable, only their depth differs.
        <span key={i} className="corner__back" data-depth={i + 1} aria-hidden="true" />
      ))}
      <CornerCard key={front.id} notice={front} />
    </aside>
  );
}

function CornerCard({ notice: n }: { notice: Notice }) {
  const t = useT();
  return (
    <div className="corner__card" data-card={n.id}>
      <div className="corner__head">
        <ProjectTile tone={n.tone} size={24} icon={n.icon(14)} />
        <div className="corner__title">{n.title}</div>
        <IconButton size="sm" label={t("common.close")} icon={<Icons.X size={14} />} onClick={n.onClose} />
      </div>
      <div className="corner__desc" role={n.alert ? "alert" : undefined}>
        {n.description}
        {n.link && (
          <>
            {" "}
            <a href={n.link.href} target="_blank" rel="noopener noreferrer">
              {n.link.label}
            </a>
          </>
        )}
      </div>
      {n.extra}
      {(n.action || n.secondary) && (
        <div className="corner__actions">
          {n.secondary && (
            <Button size="sm" variant="secondary" fullWidth onClick={n.onClose}>
              {n.secondary}
            </Button>
          )}
          {n.action && (
            <Button
              size="sm"
              fullWidth
              loading={n.busy}
              onClick={() => {
                n.onAction?.();
                // Done with it once acted on, unless it goes on its own when what it asks is settled.
                if (!n.keep) n.onClose();
              }}
            >
              {n.action}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
