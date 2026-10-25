import { IconButton, Icons, Select } from "@apx/ui";
import { useState } from "react";
import { screenChat, screensUp } from "../computers/agent.ts";
import { ComputerError } from "../computers/ComputerError.tsx";
import { useData } from "../data/state.ts";
import { usePack, useT } from "../i18n/index.ts";
import { go, useNav } from "../shell/nav.ts";
import { ComputerConsole } from "./ComputerConsole.tsx";
import { ComputerSettings } from "./ComputerSettings.tsx";
import { PanelHeader } from "./SidePanel.tsx";
import { useComputer } from "./useComputer.ts";
import { useVmDisplay } from "./useVmDisplay.ts";
import "../styles/computer.css";

/** The shared computer: the chat agent's screen (or another one picked), its lease, and setup when it is off. */
function ComputerPanelBody() {
  const t = useT();
  const thread = useNav((s) => s.threadId);
  const wide = useNav((s) => s.panelWide);
  const {
    status,
    error: controlError,
    refusal,
    setError,
    busy,
    operate,
    lower,
    refresh,
    screen: shown,
    pick,
  } = useComputer(thread);
  const [terminalMaximized, setTerminalMaximized] = useState(false);
  const ready = Boolean(status?.ready);
  const screens = status?.screens ?? [];
  const current = screens.find((s) => s.screen === shown);
  const manual = current?.control === "human" && !current.changing;
  const { screen, state, error, reconnect } = useVmDisplay(shown, ready, manual);
  const phase = status?.phase;
  const preparing = phase === "preparing" || phase === "stopping";
  const chat = status?.chat;
  const allow = Boolean(chat?.agent && chat.permitted === false);
  const r = status?.resources;
  // Running, the badge says what it runs with; the settings below say what its next start gets.
  const now = ready ? status?.running_resources : undefined;
  const badge = { cpus: now?.cpus ?? r?.cpus ?? 0, memory: now?.memory_gib ?? r?.memory_gib ?? 0 };
  const held = screensUp(status);
  const threads = useData((s) => s.threads);
  // This chat is on the Mac while its agent's screen on the computer works for another of its chats.
  const otherChat = chat && !chat.on ? screenChat(status, threads, chat.agent) : undefined;
  const elsewhere = otherChat && otherChat !== thread ? otherChat : undefined;
  const stoppedBy = phase === "stopped" && status?.last_stop?.reason;
  const label = (s: (typeof screens)[number]) =>
    t(s.run ? "computer.agentScreenHeld" : "computer.agentScreen", { agent: s.agent_name ?? "", display: s.display });
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
              <button type="button" className="computer__button" disabled={busy} onClick={() => void operate("stop")}>
                {t(phase === "preparing" ? "computer.cancelInstall" : "computer.stop")}
              </button>
            )}
          </>
        }
      >
        <div className="computer__toolbar">
          <span className={`computer__status ${state === "connected" ? "is-on" : ""}`} />
          <strong>{t("computer.title")}</strong>
          {r && <span className="computer__badge">{t("computer.badge", badge)}</span>}
        </div>
      </PanelHeader>
      {ready && (
        <div className="computer__controlbar">
          {screens.length > 0 && (
            <Select
              size="sm"
              label={t("computer.pickScreen")}
              value={shown === undefined ? null : String(shown)}
              placeholder={t("computer.noScreen")}
              onValueChange={(v) => v !== null && pick(Number(v))}
              options={screens.map((s) => ({ value: String(s.screen), label: label(s) }))}
            />
          )}
          <span className="computer__held">{t("computer.screensHeld", { held, max: status?.max_screens ?? 1 })}</span>
          {current && (
            <button
              type="button"
              className="computer__button is-primary"
              disabled={busy}
              onClick={() => void operate(manual ? "agent" : "human")}
            >
              {t(manual ? "computer.returnControl" : "computer.takeControl")}
            </button>
          )}
        </div>
      )}
      {ready && chat && !chat.on && chat.agent && (
        <div className="computer__controlbar">
          <span>
            {t(elsewhere ? "computer.chatOnMacElsewhere" : "computer.chatOnMac", { agent: chat.agent_name ?? "" })}
          </span>
          {elsewhere && (
            <button type="button" className="computer__button" onClick={() => go.thread(elsewhere)}>
              {t("computer.openOtherChat")}
            </button>
          )}
          <button
            type="button"
            className="computer__button"
            disabled={busy}
            onClick={() => void operate(allow ? "allow" : "enable")}
          >
            {allow ? t("computer.allowAndUse", { agent: chat.agent_name ?? "" }) : t("computer.useHere")}
          </button>
        </div>
      )}
      {/* Above the desktop or the setup: below the settings a narrow panel hides it. */}
      {/* A viewer's error speaks of a desktop that is up; once it is off, the reason it is off matters instead. */}
      <ComputerError
        error={(ready && error) || controlError || status?.error || ""}
        refusal={refusal}
        busy={busy}
        onLower={(gib) => void lower(gib)}
        onAnyway={() => void operate("anyway")}
      />
      {ready && shown === undefined && (
        <div className="computer__setup">
          <Icons.Monitor size={28} />
          <p>{chat?.agent_name ? t("computer.screenOff", { agent: chat.agent_name }) : t("computer.noScreen")}</p>
        </div>
      )}
      <div className="computer__desktop" hidden={!ready || shown === undefined || terminalMaximized}>
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
                : phase === "preparing"
                  ? "computer.preparing"
                  : phase === "stopping"
                    ? "computer.stopping"
                    : phase === "stopped"
                      ? "computer.offline"
                      : "computer.enableTitle",
            )}
          </strong>
          {/* Off: one sentence, for why it is off; never set up yet: what it takes. */}
          {phase === "stopped" ? (
            <p role="status">{t(`computer.lastStop.${stoppedBy || "owner"}`)}</p>
          ) : (
            <p>{t("computer.setupHint", { memory: r?.memory_gib ?? 4, disk: (r?.disk_gib ?? 24) + 2 })}</p>
          )}
          {allow && !preparing && <p>{t("computer.notAllowed", { agent: chat?.agent_name ?? "" })}</p>}
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
          {!preparing && phase !== "unsupported" && (
            <button
              type="button"
              className="computer__button is-primary"
              disabled={busy || !status || !thread}
              onClick={() => void operate(allow ? "allow" : "enable")}
            >
              {allow
                ? t("computer.allowAndEnable", { agent: chat?.agent_name ?? "" })
                : t(phase === "stopped" ? "computer.start" : phase === "error" ? "computer.retry" : "computer.enable")}
            </button>
          )}
          {status && !preparing && phase !== "unsupported" && (
            <ComputerSettings
              status={status}
              onSaved={(failure) => {
                setError(failure ?? "");
                void refresh().catch(() => {});
              }}
            />
          )}
          <small>{t("computer.closeHint")}</small>
        </div>
      )}
      {ready && thread && shown !== undefined && (
        <ComputerConsole
          thread={thread}
          screen={shown}
          agent={current?.agent_name ?? chat?.agent_name ?? ""}
          editable={manual && !busy}
          maximized={terminalMaximized}
          onMaximize={() => setTerminalMaximized((value) => !value)}
        />
      )}
    </div>
  );
}

/** Shown once its strings are loaded: they come with it, not with the first screen. */
export function ComputerPanel() {
  return usePack("computer") ? <ComputerPanelBody /> : null;
}
