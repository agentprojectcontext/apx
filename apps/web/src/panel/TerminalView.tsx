import type { TerminalInfo } from "@apx/protocol";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import { client } from "../data/client.ts";
import { watchEvents } from "../data/live.ts";
import { useT } from "../i18n/index.ts";
import { createInputQueue } from "./terminalInput.ts";

/** The panel's colors for the terminal, read from the design tokens so it follows light and dark. */
function theme(host: HTMLElement) {
  const css = getComputedStyle(host);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    background: v("--apx-bg"),
    foreground: v("--apx-fg"),
    cursor: v("--apx-fg"),
    selectionBackground: v("--apx-selection"),
  };
}

/**
 * One of the owner's shells, drawn by xterm.js: what it printed so far first, then its live output. Keys go up as
 * typed; the size follows the panel. Bytes are not interpreted here: the shell and its programs draw themselves.
 */
export default function TerminalView({ terminal }: { terminal: TerminalInfo }) {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: getComputedStyle(el).getPropertyValue("--apx-font-mono").trim() || "monospace",
      theme: theme(el),
      scrollback: 5000,
      disableStdin: !terminal.alive,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    // Output that arrives while the backlog is on its way waits behind it.
    let ready = false;
    const early: string[] = [];
    const stop = watchEvents((ev) => {
      if (ev.type === "terminal.output" && ev.terminal === terminal.id) {
        if (ready) term.write(ev.data);
        else early.push(ev.data);
      }
      if (ev.type === "terminal.exited" && ev.terminal === terminal.id)
        term.write(`\r\n\x1b[2m${t("terminal.exitedLine", { code: ev.exit_code ?? "?" })}\x1b[0m\r\n`);
    });
    void client
      .call("terminal.attach", { terminal: terminal.id })
      .then((r) => {
        term.write(r.backlog);
        for (const d of early) term.write(d);
        ready = true;
      })
      .catch(() => {
        ready = true;
      });
    const type = createInputQueue((data) => client.call("terminal.input", { terminal: terminal.id, data }));
    const typed = term.onData((data) => {
      if (terminal.alive) type(data);
    });
    let last = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const resize = () => {
      try {
        fit.fit();
      } catch {
        return;
      }
      const size = `${term.cols}x${term.rows}`;
      if (size === last || !terminal.alive) return;
      last = size;
      clearTimeout(timer);
      timer = setTimeout(() => {
        void client
          .call("terminal.resize", { terminal: terminal.id, cols: term.cols, rows: term.rows })
          .catch(() => {});
      }, 120);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    term.focus();
    return () => {
      observer.disconnect();
      clearTimeout(timer);
      stop();
      typed.dispose();
      term.dispose();
    };
  }, [terminal.id, terminal.alive, t]);
  return (
    <div className="term__view">
      {!terminal.tty && <p className="term__note">{t("terminal.noTty")}</p>}
      <div ref={host} className="term__xterm" />
    </div>
  );
}
