import { ChannelIcon, Icons } from "@apx/ui";
import type { ReactNode } from "react";
import { closeCard, useClosedCards } from "../data/cornerCards.ts";
import { diskWarning } from "../data/diskModel.ts";
import { LINKS } from "../data/links.ts";
import { useSetup } from "../data/setup.ts";
import { freeText, useDiskStatus } from "../data/storage.ts";
import { PRIVACY_URL, setUsage, useTelemetry } from "../data/telemetry.ts";
import { newerOf, openUpdate, restartApp, useUpdates } from "../data/updates.ts";
import { useV1Running } from "../data/v1Running.ts";
import { type T, useT } from "../i18n/index.ts";
import {
  busy,
  cancelDesktopInstall,
  dismissDesktopInstall,
  installDesktop,
  localBrowser,
  useDesktopInstall,
} from "./desktopInstall.ts";
import { go } from "./nav.ts";

type NoticeTone = "warning" | "danger" | "brand" | "neutral";

/** One notice, shown as a corner card (compact sidebar) or in the strip over the page. */
export type Notice = {
  id: string;
  tone: NoticeTone;
  /** Its mark at a size (14 in a card, 12 in the strip). */
  icon: (size: number) => ReactNode;
  title: string;
  description: string;
  link?: { label: string; href: string };
  /** Under the description in a card: a download's progress. */
  extra?: ReactNode;
  action?: string;
  onAction?: () => void;
  busy?: boolean;
  /** A second, quieter answer beside the action (it closes the notice). */
  secondary?: string;
  /** It stays after its action: it goes once what it asks is settled. */
  keep?: boolean;
  /** Says something wrong happened (read out as an alert). */
  alert?: boolean;
  onClose: () => void;
};

/**
 * Every notice that applies now, most pressing first: a second APX running, a full disk, a newer APX, the desktop
 * app, the telemetry question, the Discord and a star on GitHub. Each is said once per device (the update once per
 * version), never as a modal.
 */
export function useNotices(): Notice[] {
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
  const disk = useDiskStatus();
  const desktop = useDesktopNotice(t);

  const notices: Notice[] = [];
  // First: two APX daemons run the same routines and answer the same bots. Closed, it shows again next time.
  if (v1.running && !closed.v1)
    notices.push({
      id: "v1",
      tone: "warning",
      icon: (size) => <Icons.TriangleAlert size={size} />,
      title: t("v1.cardTitle"),
      description: t("v1.cardDesc"),
      action: t("v1.cardCta"),
      busy: v1.busy,
      keep: true,
      onAction: () => void v1.turnOff(),
      onClose: () => closeCard({ v1: true }),
    });
  // A full disk stops chats and files from being saved: before any news.
  if (disk && diskWarning(disk, closed.disk) === "card")
    notices.push({
      id: "disk",
      tone: "danger",
      icon: (size) => <Icons.HardDrive size={size} />,
      title: t("storage.cardTitle"),
      description: t("storage.cardDesc", { free: freeText(disk.free_bytes) }),
      action: t("storage.cardCta"),
      keep: true,
      onAction: () => go.config("storage"),
      onClose: () => closeCard({ disk: true }),
    });
  if (update?.version) {
    const version = update.version;
    // Downloaded already (the desktop app does it on its own): only the restart is left.
    const ready = update.target === "app" && app?.ready === version;
    notices.push({
      id: "update",
      tone: "brand",
      icon: (size) => <Icons.ArrowDown size={size} />,
      title: t(
        ready
          ? "update.cardReady"
          : update.target === "both"
            ? "update.cardTitleBoth"
            : update.target === "core" && window.apxDesktop?.coreLocal === false
              ? "update.cardTitleServer"
              : "update.cardTitle",
        { v: version },
      ),
      description: t(ready ? "update.cardReadyDesc" : "update.cardDesc"),
      action: t(ready ? "update.restartNow" : "update.cardCta"),
      keep: true,
      onAction: () => (ready ? void restartApp() : openUpdate(update.target)),
      onClose: () => closeCard({ update: version }),
    });
  }
  if (desktop) notices.push(desktop);
  if (ask)
    notices.push({
      id: "telemetry",
      tone: "brand",
      icon: (size) => <Icons.Activity size={size} />,
      title: t("telemetry.cardTitle"),
      description: t("telemetry.checkHint"),
      link: { label: t("telemetry.whatIsSent"), href: PRIVACY_URL },
      action: t("telemetry.cardYes"),
      keep: true,
      onAction: () => void setUsage(true),
      secondary: t("telemetry.cardNo"),
      // Closing it is a no: the card is never said twice.
      onClose: () => void setUsage(false),
    });
  if (!closed.discord)
    notices.push({
      id: "discord",
      tone: "neutral",
      icon: (size) => <ChannelIcon channel="discord" size={size} />,
      title: t("community.title"),
      description: t("community.desc"),
      action: t("community.cta"),
      onAction: () => window.open(LINKS.discord, "_blank", "noopener,noreferrer"),
      onClose: () => closeCard({ discord: true }),
    });
  // Last on purpose: it asks for something instead of offering it.
  if (!closed.star)
    notices.push({
      id: "star",
      tone: "warning",
      icon: (size) => <Icons.Star size={size} />,
      title: t("star.title"),
      description: t("star.desc"),
      action: t("star.cta"),
      onAction: () => window.open(LINKS.repo, "_blank", "noopener,noreferrer"),
      onClose: () => closeCard({ star: true }),
    });
  return notices;
}

/** The desktop app, offered in a browser on the computer that runs APX until it is installed or put off. */
function useDesktopNotice(t: T): Notice | undefined {
  const setup = useSetup((s) => s.open);
  const status = useDesktopInstall((s) => s.status);
  const dismissed = useDesktopInstall((s) => s.dismissed);
  const starting = useDesktopInstall((s) => s.starting);
  const cancelling = useDesktopInstall((s) => s.cancelling);
  const error = useDesktopInstall((s) => s.error);
  if (!localBrowser() || setup || !status?.available || dismissed) return undefined;
  if (status.installed && status.phase !== "failed" && !error) return undefined;
  const working = starting || busy(status);
  const failed = Boolean(error) || status.phase === "failed";
  const phase = starting ? "downloading" : status.phase;
  const percent = status.total ? Math.min(100, Math.floor((status.received / status.total) * 100)) : undefined;
  const downloading = phase === "downloading" && !failed;
  const size = percent === undefined ? `${Math.floor(status.received / 1048576)} MB` : `${percent}%`;
  const problem = error ? ("lost" in error ? t("desktopInstall.connectionLost") : error.message) : status.error;
  return {
    id: "desktop",
    tone: failed ? "danger" : "brand",
    icon: (px) => <Icons.Monitor size={px} />,
    title: t("desktopInstall.title"),
    description: failed
      ? [t("desktopInstall.failed"), problem].filter(Boolean).join(" ")
      : `${t(`desktopInstall.${phase}`)}${downloading ? ` ${size}` : ""}`,
    alert: failed,
    extra: working ? (
      <progress
        className="corner__progress"
        aria-label={t("desktopInstall.progress")}
        max={100}
        value={phase === "downloading" ? percent : undefined}
      />
    ) : undefined,
    ...(downloading
      ? { action: t("common.cancel"), busy: cancelling, onAction: () => void cancelDesktopInstall() }
      : (!working || failed) && status.phase !== "ready"
        ? { action: t(failed ? "common.retry" : "desktopInstall.install"), onAction: () => void installDesktop() }
        : {}),
    ...(!working && status.phase !== "ready" ? { secondary: t("desktopInstall.later") } : {}),
    keep: true,
    onClose: () => dismissDesktopInstall(true),
  };
}
