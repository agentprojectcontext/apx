import { ApxError } from "@apx/protocol/client";
import RFB from "@novnc/novnc";
import { useEffect, useRef, useState } from "react";
import { client } from "../data/client.ts";
import { useT } from "../i18n/index.ts";

/** A viewer that drops is opened again this many times in a row, a little later each time. */
const RECONNECTS = 4;
const RECONNECT_MS = 1500;

/** Whether the page is in view: a hidden tab lets its viewers go, and opens them again when shown. */
function usePageShown() {
  const [shown, setShown] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    const update = () => setShown(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return shown;
}

/** A live viewer of one agent screen; a thumbnail asks the desktop for lower quality and more compression. */
export function useVmDisplay(screenNumber: number | undefined, ready: boolean, manual: boolean, thumbnail = false) {
  const t = useT();
  // Read when an error is shown, never a reason to open the viewer again.
  const tRef = useRef(t);
  tRef.current = t;
  const shown = usePageShown();
  const screen = useRef<HTMLDivElement>(null);
  const manualRef = useRef(manual);
  manualRef.current = manual;
  const connection = useRef<RFB | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [state, setState] = useState("connecting");
  const [error, setError] = useState("");
  /** Drops in a row without a connection between them: a viewer that keeps failing stops trying and says so. */
  const drops = useRef(0);
  useEffect(() => {
    if (screenNumber === undefined || !screen.current || !ready || !shown) return;
    const t = tRef.current;
    const host = screen.current;
    const abort = new AbortController();
    let viewer: RFB | undefined;
    let disconnected = false;
    setState("connecting");
    setError("");
    void (async () => {
      const { ticket } = await client.withSignal(abort.signal).call("environments.display", { screen: screenNumber });
      if (abort.signal.aborted) return;
      const url = new URL("/vm-display", window.location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("ticket", ticket);
      url.searchParams.set("attempt", String(epoch));
      viewer = new RFB(host, url.toString());
      viewer.viewOnly = !manualRef.current;
      viewer.scaleViewport = true;
      viewer.resizeSession = false;
      if (thumbnail) {
        viewer.qualityLevel = 2;
        viewer.compressionLevel = 9;
      }
      connection.current = viewer;
      viewer.background = getComputedStyle(host).backgroundColor;
      viewer.addEventListener("connect", () => {
        drops.current = 0;
        if (!abort.signal.aborted) setState("connected");
      });
      viewer.addEventListener("disconnect", () => {
        disconnected = true;
        if (abort.signal.aborted) return;
        // A desktop that drops (a restart of its viewer, a moment without network) is opened again, a few times.
        if (drops.current < RECONNECTS) {
          drops.current++;
          setState("connecting");
          const timer = setTimeout(() => setEpoch((n) => n + 1), RECONNECT_MS * drops.current);
          abort.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
          return;
        }
        setState("disconnected");
        setError(t("computer.connectionFailed"));
      });
      viewer.addEventListener("securityfailure", () => {
        if (!abort.signal.aborted) setError(t("computer.connectionFailed"));
      });
    })().catch((e: unknown) => {
      if (!abort.signal.aborted) {
        const full =
          e instanceof ApxError && (e.detail as { reason?: unknown } | undefined)?.reason === "display_sessions";
        setError(full ? t("computer.tooManyViewers") : e instanceof Error ? e.message : String(e));
        setState("disconnected");
      }
    });
    return () => {
      abort.abort();
      if (!disconnected) viewer?.disconnect();
      connection.current = null;
    };
  }, [screenNumber, epoch, ready, shown, thumbnail]);

  useEffect(() => {
    if (connection.current && screen.current) {
      connection.current.background = getComputedStyle(screen.current).backgroundColor;
      connection.current.viewOnly = !manual;
    }
  });
  return {
    screen,
    state,
    error,
    reconnect: () => {
      drops.current = 0;
      setEpoch((n) => n + 1);
    },
  };
}
