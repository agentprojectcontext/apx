import { IconButton, Icons } from "@apx/ui";
import { useState } from "react";
import { useT } from "../i18n/index.ts";
import { go, useNav } from "../shell/nav.ts";
import { ComputerConsole } from "./ComputerConsole.tsx";
import { PanelHeader } from "./SidePanel.tsx";
import { useComputer } from "./useComputer.ts";
import { useVmDisplay } from "./useVmDisplay.ts";
import "../styles/computer.css";

export function ComputerPanel() {
  const t = useT();
  const thread = useNav((s) => s.threadId);
  const wide = useNav((s) => s.panelWide);
  const { status, error: controlError, busy, operate } = useComputer(thread);
  const [terminalMaximized, setTerminalMaximized] = useState(false);
  const manual = status?.control === "human" && !status.changing;
  const ready = Boolean(status?.ready && status.thread === thread);
  const { screen, state, error, reconnect } = useVmDisplay(thread, ready, manual);
  const phase = status?.phase;
  const preparing = phase === "preparing" || phase === "stopping";
  const assignedElsewhere = Boolean(status?.thread && status.thread !== thread);
  return (
    <div className="computer">
      <PanelHeader
        actions={
          <>
            <IconButton
              label={wide ? t("panel.narrow") : t("panel.widen")}
              icon={wide ? <Icons.Minimize2 size={14} /> : <Icons.Maximize2 size={14} />}
              onClick={() => go.togglePanelWide()}
            />
            {ready && (
              <button type="button" className="computer__button" onClick={reconnect}>
                {t("computer.reconnect")}
              </button>
            )}
            {(ready || phase === "preparing" || phase === "error") && (
              <button
                type="button"
                className="computer__button"
                disabled={busy || assignedElsewhere}
                onClick={() => void operate("environments.stop")}
              >
                {t(phase === "preparing" ? "computer.cancelInstall" : "computer.stop")}
              </button>
            )}
          </>
        }
      >
        <div className="computer__toolbar">
          <span className={`computer__status ${state === "connected" ? "is-on" : ""}`} />
          <strong>{t("computer.title")}</strong>
          <span className="computer__badge">Linux · 2 vCPU · 4 GiB</span>
        </div>
      </PanelHeader>
      {ready && (
        <div className="computer__controlbar">
          <span>
            <Icons.Lock size={13} />
            {t(manual ? "computer.manualControl" : "computer.agentControl")}
          </span>
          <button
            type="button"
            className="computer__button is-primary"
            disabled={busy}
            onClick={() => void operate(manual ? "agent" : "human")}
          >
            {t(manual ? "computer.returnControl" : "computer.takeControl")}
          </button>
        </div>
      )}
      <div className="computer__desktop" hidden={!ready || terminalMaximized}>
        <section className="computer__screen" ref={screen} aria-label={t("computer.screen")} />
        {!manual && <div className="computer__locked" role="img" aria-label={t("computer.takeControlHint")} />}
      </div>
      {!ready && (
        <div className="computer__setup">
          <Icons.AppWindow size={32} />
          <strong>
            {t(
              phase === "unsupported"
                ? "computer.unsupported"
                : assignedElsewhere
                  ? "computer.assignedElsewhere"
                  : phase === "preparing"
                    ? "computer.preparing"
                    : phase === "stopping"
                      ? "computer.stopping"
                      : phase === "stopped"
                        ? "computer.offline"
                        : "computer.enableTitle",
            )}
          </strong>
          <p>{t(phase === "stopped" ? "computer.stoppedHint" : "computer.setupHint")}</p>
          {preparing && (
            <p role="status">
              {t(
                status?.step === "runtime"
                  ? "computer.stepRuntime"
                  : status?.step === "guest"
                    ? "computer.stepGuest"
                    : phase === "stopping"
                      ? "computer.stopping"
                      : "computer.stepDesktop",
              )}
              {status?.downloaded != null && ` · ${Math.round(status.downloaded / 1048576)} MB`}
            </p>
          )}
          {!preparing && phase !== "unsupported" && !assignedElsewhere && (
            <button
              type="button"
              className="computer__button is-primary"
              disabled={busy || !status || !thread}
              onClick={() => void operate("environments.enable")}
            >
              {t(phase === "stopped" ? "computer.start" : phase === "error" ? "computer.retry" : "computer.enable")}
            </button>
          )}
          <small>{t("computer.closeHint")}</small>
        </div>
      )}
      {(error || controlError || status?.error) && (
        <div className="computer__error" role="alert">
          {error || controlError || status?.error}
        </div>
      )}
      {ready && thread && (
        <ComputerConsole
          thread={thread}
          editable={manual && !busy}
          maximized={terminalMaximized}
          onMaximize={() => setTerminalMaximized((value) => !value)}
        />
      )}
    </div>
  );
}
