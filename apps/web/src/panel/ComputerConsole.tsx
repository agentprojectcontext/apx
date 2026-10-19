import { IconButton, Icons } from "@apx/ui";
import { useRef, useState } from "react";
import { client } from "../data/client.ts";
import { useT } from "../i18n/index.ts";

export function ComputerConsole({
  thread,
  editable,
  maximized,
  onMaximize,
}: {
  thread: string;
  editable: boolean;
  maximized: boolean;
  onMaximize(): void;
}) {
  const t = useT();
  const [command, setCommand] = useState("");
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [height, setHeight] = useState(260);
  const container = useRef<HTMLDivElement>(null);
  const maxHeight = () => Math.max(180, Math.floor((container.current?.parentElement?.clientHeight ?? 700) * 0.7));
  const resize = (next: number) => setHeight(Math.max(180, Math.min(next, maxHeight())));
  const run = async () => {
    if (running || !editable || !command.trim()) return;
    const sent = command;
    setRunning(true);
    setOutput((previous) => `${previous}${previous ? "\n\n" : ""}$ ${sent}`);
    try {
      const result = await client.call("environments.command", { thread, command: sent });
      setOutput((previous) => `${previous}\n${result.output}\n[exit ${result.code}]`.slice(-131072));
      setCommand((draft) => (draft === sent ? "" : draft));
    } catch (error) {
      setOutput((previous) => `${previous}\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRunning(false);
    }
  };
  return (
    <div
      ref={container}
      className={`computer__console ${collapsed ? "is-collapsed" : ""} ${maximized ? "is-maximized" : ""}`}
      style={collapsed || maximized ? undefined : { height }}
    >
      {!collapsed && !maximized && (
        <hr
          className="computer__resize"
          tabIndex={0}
          aria-label={t("computer.resizeTerminal")}
          aria-orientation="horizontal"
          aria-valuemin={180}
          aria-valuemax={maxHeight()}
          aria-valuenow={height}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              resize(height + (event.key === "ArrowUp" ? 30 : -30));
            }
          }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            event.preventDefault();
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              resize((container.current?.getBoundingClientRect().bottom ?? 0) - event.clientY);
          }}
          onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
        />
      )}
      <div className="computer__console-title">
        <Icons.Terminal size={14} />
        <strong>{t("computer.terminal")}</strong>
        <code>/home/apx/work</code>
        <IconButton
          label={collapsed ? t("computer.expandTerminal") : t("computer.minimizeTerminal")}
          icon={collapsed ? <Icons.ChevronUp size={14} /> : <Icons.Minus size={14} />}
          onClick={() => {
            if (maximized) onMaximize();
            setCollapsed(!collapsed);
          }}
        />
        <IconButton
          label={maximized ? t("computer.restoreTerminal") : t("computer.maximizeTerminal")}
          icon={maximized ? <Icons.Minimize2 size={14} /> : <Icons.Maximize2 size={14} />}
          onClick={() => {
            setCollapsed(false);
            onMaximize();
          }}
        />
      </div>
      {!collapsed && (
        <>
          <pre className="computer__output" role="log" aria-label={t("computer.output")}>
            {output || t("computer.consoleHint")}
          </pre>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run();
            }}
          >
            <textarea
              aria-label={t("computer.command")}
              placeholder={t(editable ? "computer.commandPlaceholder" : "computer.takeControlHint")}
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              spellCheck={false}
              maxLength={4000}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void run();
                }
              }}
            />
            <div className="computer__editor-footer">
              <span>{t("computer.commandShortcut")}</span>
              <button
                type="submit"
                className="computer__button is-primary"
                disabled={running || !editable || !command.trim()}
              >
                <Icons.ArrowUp size={14} />
                {t(running ? "common.running" : "computer.sendCommand")}
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
