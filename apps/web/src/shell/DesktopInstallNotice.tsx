import type { DesktopInstallStatus } from "@apx/protocol";
import { Button, IconButton, Icons, NavItem } from "@apx/ui";
import { useEffect, useRef, useState } from "react";
import { client, keyStore } from "../data/client.ts";
import { useSetup } from "../data/setup.ts";
import { useT } from "../i18n/index.ts";
import "../styles/desktop-install.css";

const localBrowser = () =>
  !window.apxDesktop &&
  ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname) &&
  !/Android|iPhone|iPad/i.test(navigator.userAgent);
const busy = (s?: DesktopInstallStatus) => s && ["downloading", "installing", "opening"].includes(s.phase);
const showOutcome = (next: DesktopInstallStatus) => next.phase === "failed" || next.phase === "ready";
const DISMISSED = "apx.desktop-install.dismissed";
const readDismissed = () => {
  try {
    return keyStore()?.getItem(DISMISSED) === "1";
  } catch {
    return false;
  }
};
const rememberDismissed = (closed: boolean) => {
  try {
    if (closed) keyStore()?.setItem(DISMISSED, "1");
    else keyStore()?.removeItem(DISMISSED);
  } catch {
    // Storage restrictions do not prevent this session from closing the notice.
  }
};

/** Existing browser installations can adopt the desktop without another setup or a data migration. */
export function DesktopInstallNotice({ rail = false }: { rail?: boolean }) {
  const t = useT();
  const setup = useSetup((s) => s.open);
  const [status, setStatus] = useState<DesktopInstallStatus>();
  const [dismissed, setDismissed] = useState(readDismissed);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [error, setError] = useState<string>();
  const [pollKey, setPollKey] = useState(0);
  const active = useRef(true);
  const submitting = useRef<{ request: number; kind: "install" | "cancel" } | undefined>(undefined);
  const revision = useRef(0);
  useEffect(() => {
    if (!localBrowser() || pollKey !== revision.current) return;
    active.current = true;
    let cancelled = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const request = revision.current;
      try {
        const next = await client.call("desktop.install_status", {});
        if (cancelled || request !== revision.current) return;
        setStatus(next);
        if (showOutcome(next)) setMinimized(false);
        failures = 0;
        setError(undefined);
        if (busy(next)) timer = setTimeout(() => void load(), 500);
      } catch {
        if (!cancelled && request === revision.current && submitting.current === undefined) {
          setMinimized(false);
          setError(t("desktopInstall.connectionLost"));
          failures++;
          timer = setTimeout(() => void load(), Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)));
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [t, pollKey]);
  useEffect(
    () => () => {
      active.current = false;
    },
    [],
  );

  const dismiss = (closed: boolean) => {
    setDismissed(closed);
    rememberDismissed(closed);
  };

  const cancel = async () => {
    if (starting || submitting.current?.kind === "cancel" || status?.phase !== "downloading") return;
    revision.current++;
    const request = revision.current;
    submitting.current = { request, kind: "cancel" };
    setCancelling(true);
    setError(undefined);
    try {
      const next = await client.call("desktop.install_cancel", {});
      if (active.current && request === revision.current) {
        setStatus(next);
        setMinimized(false);
      }
    } catch (e) {
      if (active.current && request === revision.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (submitting.current?.request === request) submitting.current = undefined;
      if (active.current && request === revision.current) {
        setCancelling(false);
        setStarting(false);
        setPollKey(revision.current);
      }
    }
  };

  const install = async () => {
    if (submitting.current) return;
    if (busy(status) && error) {
      revision.current++;
      setPollKey(revision.current);
      setError(undefined);
      return;
    }
    dismiss(false);
    revision.current++;
    const request = revision.current;
    submitting.current = { request, kind: "install" };
    setStarting(true);
    setError(undefined);
    setStatus((current) => (current ? { ...current, phase: "downloading", error: undefined } : current));
    try {
      const next = await client.call("desktop.install", {});
      if (active.current && request === revision.current) {
        setStatus(next);
        setPollKey(revision.current);
      }
    } catch (e) {
      if (active.current && request === revision.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (submitting.current?.request === request) submitting.current = undefined;
      if (active.current && request === revision.current) setStarting(false);
    }
  };

  if (!localBrowser() || setup || !status?.available) return null;
  return (
    <>
      {(status.installed || dismissed) && (
        <div className="desktop-launch">
          <NavItem
            collapsed={rail}
            icon={<Icons.Monitor />}
            label={t(
              starting || busy(status)
                ? "desktopInstall.opening"
                : status.installed
                  ? "desktopInstall.open"
                  : "desktopInstall.install",
            )}
            disabled={starting || Boolean(busy(status))}
            onClick={() => void install()}
          />
        </div>
      )}
      {!dismissed && (!status.installed || status.phase === "failed" || error) && (
        <DesktopInstallCard
          status={status}
          starting={starting}
          cancelling={cancelling}
          minimized={minimized}
          error={error}
          onCancel={() => void cancel()}
          onInstall={() => void install()}
          onDismiss={() => dismiss(true)}
          onToggle={() => setMinimized((current) => !current)}
        />
      )}
    </>
  );
}

type DesktopInstallCardProps = {
  status: DesktopInstallStatus;
  starting: boolean;
  cancelling: boolean;
  minimized: boolean;
  error: string | undefined;
  onCancel: () => void;
  onInstall: () => void;
  onDismiss: () => void;
  onToggle: () => void;
};

function DesktopInstallCard({
  status,
  starting,
  cancelling,
  minimized,
  error,
  onCancel,
  onInstall,
  onDismiss,
  onToggle,
}: DesktopInstallCardProps) {
  const t = useT();
  const working = starting || busy(status);
  const failed = Boolean(error) || status.phase === "failed";
  const phase = starting ? "downloading" : status.phase;
  const percent = status.total ? Math.min(100, Math.floor((status.received / status.total) * 100)) : undefined;
  const collapsed = minimized && !failed && status.phase !== "ready";
  const minLabel =
    phase === "downloading" && percent !== undefined
      ? `${percent}%`
      : phase === "idle"
        ? t("desktopInstall.title")
        : t(`desktopInstall.${phase}`);
  const progress = working ? (
    <progress
      aria-label={t("desktopInstall.progress")}
      max={100}
      value={phase === "downloading" ? percent : undefined}
    />
  ) : null;
  const fold =
    !failed && status.phase !== "ready" ? (
      <IconButton
        key="fold"
        size="sm"
        label={t(collapsed ? "desktopInstall.restore" : "desktopInstall.minimize")}
        tooltipSide="bottom"
        aria-expanded={!collapsed}
        icon={collapsed ? <Icons.ChevronUp size={16} /> : <Icons.ChevronDown size={16} />}
        onClick={onToggle}
      />
    ) : null;
  if (collapsed) {
    return (
      <aside className="desktop-install desktop-install--min" aria-label={t("desktopInstall.title")}>
        <Icons.Monitor size={16} />
        <div className="desktop-install__minbody">
          <span>{minLabel}</span>
          {progress}
        </div>
        {phase === "downloading" && !failed && (
          <Button size="sm" variant="ghost" disabled={starting || cancelling} onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        )}
        {fold}
      </aside>
    );
  }
  return (
    <aside className="desktop-install" aria-label={t("desktopInstall.title")}>
      <Icons.Monitor size={19} />
      <div className="desktop-install__body">
        <strong>{t("desktopInstall.title")}</strong>
        <p aria-live="polite">{failed ? t("desktopInstall.failed") : t(`desktopInstall.${phase}`)}</p>
        {progress}
        {working && phase === "downloading" && (
          <small>{percent === undefined ? `${Math.floor(status.received / 1048576)} MB` : `${percent}%`}</small>
        )}
        {failed && <p role="alert">{error || status.error}</p>}
      </div>
      {phase === "downloading" && !failed && (
        <Button size="sm" variant="ghost" disabled={starting || cancelling} onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      )}
      {(!working || failed) && status.phase !== "ready" && (
        <Button size="sm" onClick={onInstall}>
          {t(failed ? "common.retry" : "desktopInstall.install")}
        </Button>
      )}
      {!working && (
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          {t(status.phase === "ready" ? "common.close" : "desktopInstall.later")}
        </Button>
      )}
      {fold}
    </aside>
  );
}
