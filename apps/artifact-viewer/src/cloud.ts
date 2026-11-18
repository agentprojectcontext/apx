import { createPublicationWatch } from "./watch.ts";

export function watchPublication(
  code: string,
  changed: (state: "waiting" | "live" | "missing", metadata?: unknown) => void,
  failed: (missing: boolean) => void,
) {
  return createPublicationWatch(
    {
      async metadata(signal) {
        const response = await fetch(`/api/copies/${code}/meta`, {
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          signal,
        });
        if (!response.ok)
          throw new Error(response.status === 404 ? "public_artifact_missing" : "public_artifact_unavailable");
        const text = await response.text();
        if (text.length > 4096) throw new Error("public_artifact_unavailable");
        return JSON.parse(text) as unknown;
      },
      socket() {
        const url = new URL(`/api/copies/${code}/events`, window.location.origin);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        const socket = new WebSocket(url);
        return {
          listen(events) {
            socket.onopen = () => events.open();
            socket.onclose = () => events.closed();
            socket.onerror = () => events.closed();
            socket.onmessage = (event) => events.message(event.data);
            return () => {
              socket.onopen = null;
              socket.onclose = null;
              socket.onerror = null;
              socket.onmessage = null;
            };
          },
          close() {
            socket.close();
          },
        };
      },
      hidden: () => document.hidden,
      visibility(notify) {
        document.addEventListener("visibilitychange", notify);
        return () => document.removeEventListener("visibilitychange", notify);
      },
      after(ms, notify) {
        const timer = window.setTimeout(notify, ms);
        return () => window.clearTimeout(timer);
      },
    },
    changed,
    failed,
  );
}
