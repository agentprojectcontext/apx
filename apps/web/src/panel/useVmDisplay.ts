import RFB from "@novnc/novnc";
import { useEffect, useRef, useState } from "react";
import { client } from "../data/client.ts";
import { useT } from "../i18n/index.ts";

export function useVmDisplay(thread: string | undefined, ready: boolean, manual: boolean) {
  const t = useT();
  const screen = useRef<HTMLDivElement>(null);
  const manualRef = useRef(manual);
  manualRef.current = manual;
  const connection = useRef<RFB | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [state, setState] = useState("connecting");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!thread || !screen.current || !ready) return;
    const host = screen.current;
    const abort = new AbortController();
    let viewer: RFB | undefined;
    let disconnected = false;
    setState("connecting");
    setError("");
    void (async () => {
      const { ticket } = await client.withSignal(abort.signal).call("environments.display", { thread });
      if (abort.signal.aborted) return;
      const url = new URL("/vm-display", window.location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("ticket", ticket);
      url.searchParams.set("attempt", String(epoch));
      viewer = new RFB(host, url.toString());
      viewer.viewOnly = !manualRef.current;
      viewer.scaleViewport = true;
      viewer.resizeSession = false;
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
        setError(e instanceof Error ? e.message : String(e));
        setState("disconnected");
      }
    });
    return () => {
      abort.abort();
      if (!disconnected) viewer?.disconnect();
      connection.current = null;
    };
  }, [thread, epoch, ready, t]);

  useEffect(() => {
    if (connection.current && screen.current) {
      connection.current.background = getComputedStyle(screen.current).backgroundColor;
      connection.current.viewOnly = !manual;
    }
  });
  return { screen, state, error, reconnect: () => setEpoch((n) => n + 1) };
}
