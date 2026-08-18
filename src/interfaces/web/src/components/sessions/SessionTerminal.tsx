import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { getToken } from "../../lib/http";
import { t } from "../../i18n";

// A real terminal, running the session's own CLI on the daemon's machine.
//
// Everything here is bytes in both directions: keystrokes go up the socket,
// output comes back and is written straight to xterm. No parsing, no framing —
// claude and opencode draw themselves, and anything we interpreted along the
// way would only be a chance to corrupt their output.
//
// The size is fixed for the life of the connection: the daemon sizes the pty
// once, at spawn. Resizing the pane afterwards is not wired through, so we
// remount on size changes instead — the session is re-opened rather than
// reflowed, which the CLIs handle (they redraw from their own state).
export function SessionTerminal({
  engine,
  id,
  className,
  onExit,
}: {
  engine: string;
  id: string;
  className?: string;
  onExit?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"connecting" | "open" | "closed">("connecting");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      convertEol: false,
      cursorBlink: true,
      fontSize: 12,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      // Transparent so the panel's own theme shows through; the CLIs paint
      // their own colours over it.
      theme: { background: "#0a0a0a" },
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const params = new URLSearchParams({
      engine,
      id,
      rows: String(term.rows),
      cols: String(term.cols),
    });
    const token = getToken();
    if (token) params.set("token", token);
    const ws = new WebSocket(`${proto}//${window.location.host}/api/terminal/ws?${params.toString()}`);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => { setStatus("open"); term.focus(); };
    ws.onmessage = (ev) => {
      term.write(typeof ev.data === "string" ? ev.data : new Uint8Array(ev.data));
    };
    ws.onclose = () => { setStatus("closed"); onExit?.(); };
    ws.onerror = () => setStatus("closed");

    const typed = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(new TextEncoder().encode(data));
    });

    // The pty size is fixed server-side, so only fit locally — a mismatch shows
    // as wrapping, not as a broken session.
    const onResize = () => { try { fit.fit(); } catch { /* detached */ } };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      typed.dispose();
      try { ws.close(); } catch { /* already gone */ }
      term.dispose();
    };
  }, [engine, id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={className}>
      <div ref={hostRef} className="h-full w-full overflow-hidden rounded-md bg-[#0a0a0a] p-1" />
      {status !== "open" && (
        <div className="pointer-events-none absolute bottom-2 right-3 text-[10px] text-muted-fg">
          {status === "connecting" ? t("base.sessions_term_connecting") : t("base.sessions_term_closed")}
        </div>
      )}
    </div>
  );
}
