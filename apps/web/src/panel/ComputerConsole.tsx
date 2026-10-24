import { IconButton, Icons } from "@apx/ui";
import { useLayoutEffect, useRef, useState } from "react";
import { client } from "../data/client.ts";
import { useT } from "../i18n/index.ts";

/**
 * The least the pane may be: its title, a few lines of output and the command box at its tallest, so a drag never
 * hides any of them.
 */
export const CONSOLE_MIN_PX = 220;
/** The command box grows with a long command up to this, then scrolls. */
const COMMAND_MAX_PX = 96;

export function ComputerConsole({
  thread,
  screen,
  agent,
  editable,
  maximized,
  onMaximize,
}: {
  thread: string;
  /** The screen its commands run on, as that screen's user. */
  screen: number;
  /** Whose Linux user that is. */
  agent: string;
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
  const box = useRef<HTMLTextAreaElement>(null);
  const maxHeight = () =>
    Math.max(CONSOLE_MIN_PX, Math.floor((container.current?.parentElement?.clientHeight ?? 700) * 0.7));
  const resize = (next: number) => setHeight(Math.max(CONSOLE_MIN_PX, Math.min(next, maxHeight())));
  // One line until the command is longer: the box takes the height of what is in it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the height follows the command's text.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    // Empty, it stays one line: a long placeholder in a narrow pane is cut, never a taller box.
    if (command) el.style.height = `${Math.min(el.scrollHeight, COMMAND_MAX_PX)}px`;
    else el.style.height = "";
  }, [command, collapsed]);
  const run = async () => {
    if (running || !editable || !command.trim()) return;
    const sent = command;
    setRunning(true);
    setOutput((previous) => `${previous}${previous ? "\n\n" : ""}$ ${sent}`);
    try {
      const result = await client.call("environments.command", { thread, command: sent, screen });
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
          aria-valuemin={CONSOLE_MIN_PX}
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
        <code>~/work</code>
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
            {output || t("computer.consoleHint", { agent })}
          </pre>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run();
            }}
          >
            <span className="computer__prompt" aria-hidden="true">
              $
            </span>
            <textarea
              ref={box}
              rows={1}
              aria-label={t("computer.command")}
              placeholder={t(editable ? "computer.commandPlaceholder" : "computer.takeControlHint")}
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              spellCheck={false}
              maxLength={4000}
              onKeyDown={(event) => {
                // Enter sends, as in a terminal; Shift+Enter writes a new line.
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void run();
                }
              }}
            />
            <button
              type="submit"
              className="computer__button is-primary"
              title={t("computer.commandShortcut")}
              disabled={running || !editable || !command.trim()}
            >
              <Icons.ArrowUp size={14} />
              {t(running ? "common.running" : "computer.sendCommand")}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
