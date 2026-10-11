import "../styles/corner.css";
import { Button, ChannelIcon, IconButton, Icons, ProjectTile } from "@apx/ui";
import type { CSSProperties, ReactNode } from "react";
import { closeCard, useClosedCards } from "../data/cornerCards.ts";
import { newerOf, openUpdate, restartApp, useUpdates } from "../data/updates.ts";
import { useT } from "../i18n/index.ts";

const LINKS = {
  discord: "https://discord.gg/vxdZuT5WuE",
  // The public repo: where the releases and the docs live.
  repo: "https://github.com/agentprojectcontext/apx",
} as const;

/**
 * A small deck: a newer APX, the Discord, a star on GitHub. Only the first that still applies shows; the next peeks
 * out behind it and comes forward when it is closed. Each one is said once per device (the update card once per
 * version), never as a modal. At the foot of the sidebar; floating beside it when the sidebar is a rail, away from the
 * composer.
 */
export function CornerCards({ floating = false }: { floating?: boolean }) {
  const t = useT();
  const closed = useClosedCards((s) => s);
  const status = useUpdates((s) => s.status);
  const app = useUpdates((s) => s.app);
  const newer = newerOf(status, app);
  // A checkout behind main has no version to name: the top bar's pill says it.
  const update = newer?.version && closed.update !== newer.version ? newer : undefined;

  const cards: ReactNode[] = [];
  if (update?.version) {
    const version = update.version;
    // Downloaded already (the desktop app does it on its own): only the restart is left.
    const ready = update.target === "app" && app?.ready === version;
    cards.push(
      <CornerCard
        key="update"
        id="update"
        icon={<ProjectTile tone="brand" size={24} icon={<Icons.ArrowDown size={14} />} />}
        title={t(
          ready
            ? "update.cardReady"
            : update.target === "both"
              ? "update.cardTitleBoth"
              : update.target === "core" && window.apxDesktop?.coreLocal === false
                ? "update.cardTitleServer"
                : "update.cardTitle",
          { v: version },
        )}
        description={t(ready ? "update.cardReadyDesc" : "update.cardDesc")}
        action={t(ready ? "update.restartNow" : "update.cardCta")}
        onAction={() => (ready ? restartApp() : openUpdate(update.target))}
        onClose={() => closeCard({ update: version })}
      />,
    );
  }
  if (!closed.discord)
    cards.push(
      <CornerCard
        key="discord"
        id="discord"
        icon={<ProjectTile tone="neutral" size={24} icon={<ChannelIcon channel="discord" size={14} />} />}
        title={t("community.title")}
        description={t("community.desc")}
        action={t("community.cta")}
        onAction={() => window.open(LINKS.discord, "_blank", "noopener,noreferrer")}
        onClose={() => closeCard({ discord: true })}
      />,
    );
  // Last on purpose: it asks for something instead of offering it.
  if (!closed.star)
    cards.push(
      <CornerCard
        key="star"
        id="star"
        icon={<ProjectTile tone="warning" size={24} icon={<Icons.Star size={14} />} />}
        title={t("star.title")}
        description={t("star.desc")}
        action={t("star.cta")}
        onAction={() => window.open(LINKS.repo, "_blank", "noopener,noreferrer")}
        onClose={() => closeCard({ star: true })}
      />,
    );
  if (!cards.length) return null;
  return (
    <aside
      className={floating ? "corner is-floating" : "corner"}
      aria-label={t("corner.label")}
      style={{ "--corner-peek": `${(Math.min(cards.length, 3) - 1) * 8}px` } as CSSProperties}
    >
      {cards.slice(0, 3)}
    </aside>
  );
}

function CornerCard(props: {
  id: string;
  icon: ReactNode;
  title: string;
  description: string;
  action: string;
  onAction(): void;
  onClose(): void;
}) {
  const t = useT();
  return (
    <div className="corner__card" data-card={props.id}>
      <div className="corner__head">
        {props.icon}
        <div className="corner__title">{props.title}</div>
        <IconButton size="sm" label={t("common.close")} icon={<Icons.X size={14} />} onClick={props.onClose} />
      </div>
      <div className="corner__desc">{props.description}</div>
      <Button
        size="sm"
        fullWidth
        onClick={() => {
          props.onAction();
          // Done with it once acted on; the update card stays until it is updated or closed.
          if (props.id !== "update") props.onClose();
        }}
      >
        {props.action}
      </Button>
    </div>
  );
}
