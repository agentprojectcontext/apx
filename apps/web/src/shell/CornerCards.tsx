import "../styles/corner.css";
import { Button, ChannelIcon, IconButton, Icons, ProjectTile } from "@apx/ui";
import type { CSSProperties, ReactNode } from "react";
import { closeCard, useClosedCards } from "../data/cornerCards.ts";
import { LINKS } from "../data/links.ts";
import { PRIVACY_URL, setUsage, useTelemetry } from "../data/telemetry.ts";
import { newerOf, openUpdate, restartApp, useUpdates } from "../data/updates.ts";
import { useV1Running } from "../data/v1Running.ts";
import { useT } from "../i18n/index.ts";

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
  const v1 = useV1Running();
  // An install from before telemetry: asked once here; a fresh one answered in the setup.
  const ask = useTelemetry((s) => s.state?.enabled === true && s.state.usage === null);

  const cards: ReactNode[] = [];
  // First: two APX daemons run the same routines and answer the same bots. Closed, it shows again next time.
  if (v1.running && !closed.v1)
    cards.push(
      <CornerCard
        key="v1"
        id="v1"
        icon={<ProjectTile tone="warning" size={24} icon={<Icons.TriangleAlert size={14} />} />}
        title={t("v1.cardTitle")}
        description={t("v1.cardDesc")}
        action={t("v1.cardCta")}
        busy={v1.busy}
        onAction={() => void v1.turnOff()}
        onClose={() => closeCard({ v1: true })}
      />,
    );
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
  if (ask)
    cards.push(
      <CornerCard
        key="telemetry"
        id="telemetry"
        icon={<ProjectTile tone="brand" size={24} icon={<Icons.Activity size={14} />} />}
        title={t("telemetry.cardTitle")}
        description={t("telemetry.checkHint")}
        link={{ label: t("telemetry.whatIsSent"), href: PRIVACY_URL }}
        action={t("telemetry.cardYes")}
        onAction={() => void setUsage(true)}
        secondary={t("telemetry.cardNo")}
        // Closing it is a no: the card is never said twice.
        onClose={() => void setUsage(false)}
      />,
    );
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
  /** A second, quieter answer beside the action (it closes the card). */
  secondary?: string;
  link?: { label: string; href: string };
  busy?: boolean;
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
      <div className="corner__desc">
        {props.description}
        {props.link && (
          <>
            {" "}
            <a href={props.link.href} target="_blank" rel="noopener noreferrer">
              {props.link.label}
            </a>
          </>
        )}
      </div>
      <div className="corner__actions">
        {props.secondary && (
          <Button size="sm" variant="secondary" fullWidth onClick={props.onClose}>
            {props.secondary}
          </Button>
        )}
        <Button
          size="sm"
          fullWidth
          loading={props.busy}
          onClick={() => {
            props.onAction();
            // Done with it once acted on; the update, v1 and telemetry cards go when what they ask is settled.
            if (props.id !== "update" && props.id !== "v1" && props.id !== "telemetry") props.onClose();
          }}
        >
          {props.action}
        </Button>
      </div>
    </div>
  );
}
