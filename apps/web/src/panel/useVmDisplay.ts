import { ApxError } from "@apx/protocol/client";
import RFB from "@novnc/novnc";
import { useEffect, useRef, useState } from "react";
import { client } from "../data/client.ts";
import { useT } from "../i18n/index.ts";

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
        if (!abort.signal.aborted) setState("connected");
      });
      viewer.addEventListener("disconnect", () => {
        disconnected = true;
        if (!abort.signal.aborted) {
          setState("disconnected");
          setError(t("computer.connectionFailed"));
        }
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
  return { screen, state, error, reconnect: () => setEpoch((n) => n + 1) };
}
