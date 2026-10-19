import type { DesktopInstallStatus } from "@apx/protocol";
import { Button, Icons } from "@apx/ui";
import { useEffect, useRef, useState } from "react";
import { client } from "../data/client.ts";
import { useSetup } from "../data/setup.ts";
import { useT } from "../i18n/index.ts";
import "../styles/desktop-install.css";

const localBrowser = () =>
  !window.apxDesktop &&
  ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname) &&
  !/Android|iPhone|iPad/i.test(navigator.userAgent);
const busy = (s?: DesktopInstallStatus) => s && ["downloading", "installing", "opening"].includes(s.phase);

/** Existing browser installations can adopt the desktop without another setup or a data migration. */
export function DesktopInstallNotice() {
  const t = useT();
  const setup = useSetup((s) => s.open);
  const [status, setStatus] = useState<DesktopInstallStatus>();
  const [dismissed, setDismissed] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const [pollKey, setPollKey] = useState(0);
  const active = useRef(true);
  const submitting = useRef(false);
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
        failures = 0;
        setError(undefined);
        if (busy(next)) timer = setTimeout(() => void load(), 500);
      } catch {
        if (!cancelled && request === revision.current && submitting.current === false) {
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

  const install = async () => {
    if (submitting.current) return;
    if (busy(status) && error) {
      revision.current++;
      setPollKey(revision.current);
      setError(undefined);
      return;
    }
    submitting.current = true;
    revision.current++;
    setStarting(true);
    setError(undefined);
    setStatus((current) => (current ? { ...current, phase: "downloading", error: undefined } : current));
    try {
      const next = await client.call("desktop.install", {});
      if (active.current) {
        setStatus(next);
        setPollKey(revision.current);
      }
    } catch (e) {
      if (active.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      submitting.current = false;
      if (active.current) setStarting(false);
    }
  };

  if (!localBrowser() || dismissed || setup || !status?.available || (status.installed && status.phase === "idle"))
    return null;
  const working = starting || busy(status);
  const failed = Boolean(error) || status.phase === "failed";
  const phase = starting ? "downloading" : status.phase;
  const percent = status.total ? Math.min(100, Math.floor((status.received / status.total) * 100)) : undefined;
  return (
    <aside className="desktop-install" aria-label={t("desktopInstall.title")}>
      <Icons.Monitor size={19} />
      <div className="desktop-install__body">
        <strong>{t("desktopInstall.title")}</strong>
        <p aria-live="polite">{failed ? t("desktopInstall.failed") : t(`desktopInstall.${phase}`)}</p>
        {working && (
          <>
            <progress
              aria-label={t("desktopInstall.progress")}
              max={100}
              value={phase === "downloading" ? percent : undefined}
            />
            {phase === "downloading" && (
              <small>{percent === undefined ? `${Math.floor(status.received / 1048576)} MB` : `${percent}%`}</small>
            )}
          </>
        )}
        {failed && <p role="alert">{error || status.error}</p>}
      </div>
      {(!working || failed) && status.phase !== "ready" && (
        <Button size="sm" onClick={() => void install()}>
          {t(failed ? "common.retry" : "desktopInstall.install")}
        </Button>
      )}
      {!working && (
        <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
          {t(status.phase === "ready" ? "common.close" : "desktopInstall.later")}
        </Button>
      )}
    </aside>
  );
}
