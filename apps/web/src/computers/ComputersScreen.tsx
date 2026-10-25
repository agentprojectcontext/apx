import "../styles/screens.css";
import "../styles/computer.css";
import type { ComputerMemoryRefusal, ComputerScreen, Result } from "@apx/protocol";
import { ApxError } from "@apx/protocol/client";
import { AgentAvatar, Button, EmptyState, IconButton, Icons, Menu } from "@apx/ui";
import { useEffect, useRef, useState } from "react";
import { ChatView } from "../chat/ChatView.tsx";
import { client } from "../data/client.ts";
import { data, useData } from "../data/state.ts";
import { usePack, useT } from "../i18n/index.ts";
import { useVmDisplay } from "../panel/useVmDisplay.ts";
import { go, useNav } from "../shell/nav.ts";
import { screenChat, screensUp } from "./agent.ts";
import { ComputerError } from "./ComputerError.tsx";
import { memoryRefusal } from "./refusal.ts";
import { computersOf } from "./summary.ts";

type Status = Result<"environments.status">;
type ScreensFull = { max: number; up: string[] };

/** The cap a screen start ran into, from the refusal's detail; else undefined. */
function screensFull(failure: unknown): ScreensFull | undefined {
  const d = failure instanceof ApxError ? (failure.detail as Record<string, unknown> | undefined) : undefined;
  if (!d || typeof d !== "object" || d.reason !== "screens_full") return undefined;
  const up = Array.isArray(d.up) ? d.up.filter((n): n is string => typeof n === "string") : [];
  return { max: typeof d.max === "number" ? d.max : up.length, up };
}

/** Polled while this view is open: every viewer below lives only as long as the view does. */
function useComputerStatus() {
  const [status, setStatus] = useState<Status>();
  const [error, setError] = useState("");
  const now = useRef<() => void>(() => {});
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await client.withSignal(abort.signal).call("environments.status", {});
        if (abort.signal.aborted) return;
        setStatus(next);
        data.set({ vmThreads: next.chats ?? [], computers: computersOf(next) });
      } catch (failure) {
        if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(() => void poll(), 2500);
      }
    };
    now.current = () => {
      clearTimeout(timer);
      void poll();
    };
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, []);
  return { status, error, setError, refresh: () => now.current() };
}

function Holder({ screen, title }: { screen: ComputerScreen; title?: string | undefined }) {
  const t = useT();
  const agent = useData((s) => (screen.agent ? s.agents[screen.agent] : undefined));
  const mine = screen.control === "human";
  const state = mine ? "computers.youControl" : screen.run ? "computers.agentDrives" : "computers.screenIdle";
  return (
    <div className="computers__holder">
      <AgentAvatar name={screen.agent_name ?? ""} blob={agent?.blob} size={22} animated={false} />
      <div>
        <strong>{screen.agent_name}</strong>
        <span>{(screen.title ?? title) || t("computers.untitled")}</span>
      </div>
      <span className={`computers__state ${mine ? "is-human" : screen.run ? "" : "is-idle"}`}>{t(state)}</span>
    </div>
  );
}

/** One screen in use, small and view-only: a viewer with low quality and high compression. */
function Tile({
  screen,
  title,
  ready,
  busy,
  onOpen,
  onOff,
}: {
  screen: ComputerScreen;
  title?: string | undefined;
  ready: boolean;
  busy: boolean;
  onOpen(): void;
  /** Absent while a run holds the screen. */
  onOff?: (() => void) | undefined;
}) {
  const t = useT();
  const view = useVmDisplay(screen.screen, ready, false, true);
  return (
    <div className="computers__tile">
      <button
        type="button"
        className="computers__thumb"
        onClick={onOpen}
        aria-label={t("computers.openScreen", { agent: screen.agent_name ?? "" })}
      >
        <section className="computer__screen" ref={view.screen} aria-label={t("computer.screen")} />
      </button>
      <div className="computers__foot">
        <Holder screen={screen} title={title} />
        <div className="computers__actions">
          <Button size="sm" variant="secondary" onClick={onOpen}>
            {t("computers.open")}
          </Button>
          {onOff && (
            <Button size="sm" variant="secondary" loading={busy} onClick={onOff}>
              {t("computers.turnOff")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** An allowed agent whose screen is not up: a calm placeholder with the way to turn it on. */
function OffTile({
  agent,
  busy,
  full,
  onOn,
}: {
  agent: string;
  busy: boolean;
  full?: ScreensFull | undefined;
  onOn(): void;
}) {
  const t = useT();
  const record = useData((s) => s.agents[agent]);
  const name = record?.name ?? agent;
  return (
    <div className="computers__tile is-off">
      <div className="computers__thumb is-off">
        <Icons.Monitor size={28} />
        <span>{t("computers.screenOff")}</span>
      </div>
      <div className="computers__foot">
        <div className="computers__holder">
          <AgentAvatar name={name} blob={record?.blob} size={22} animated={false} />
          <div>
            <strong>{name}</strong>
          </div>
        </div>
        <div className="computers__actions">
          <Button size="sm" loading={busy} onClick={onOn}>
            {t("computers.turnOn")}
          </Button>
        </div>
      </div>
      {full && (
        <p className="computers__full" role="alert">
          {t("computers.full", { max: full.max, up: full.up.join(", ") })}
        </p>
      )}
    </div>
  );
}

/** One screen large: one toolbar, the desktop, and its agent's chat beside it on demand. */
function Large({
  screen,
  chatOf,
  ready,
  busyOff,
  onBack,
  onError,
  onOff,
  onStopAll,
}: {
  screen: ComputerScreen;
  /** Its agent's chat when no run holds it now. */
  chatOf?: string | undefined;
  ready: boolean;
  busyOff: boolean;
  onBack(): void;
  onError(message: string): void;
  /** Absent while a run holds the screen. */
  onOff?: (() => void) | undefined;
  onStopAll(): void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const manual = screen.control === "human" && !screen.changing;
  const view = useVmDisplay(screen.screen, ready, manual);
  // Taking control ends the agent's run, and with it the claim: the chat it opened with stays reachable.
  const [chat] = useState(() => ({ thread: screen.thread, title: screen.title }));
  const thread = screen.thread ?? chat.thread ?? chatOf;
  const fallbackTitle = useData((s) => (chatOf ? s.threads[chatOf]?.title : undefined));
  const control = async () => {
    setBusy(true);
    try {
      await client.call("environments.control", { screen: screen.screen, mode: manual ? "agent" : "human" });
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="computers__large">
      <div className="computer__controlbar">
        <Button size="sm" variant="secondary" leadingIcon={<Icons.ChevronLeft size={14} />} onClick={onBack}>
          {t("computers.all")}
        </Button>
        <Holder screen={screen} title={chat.title ?? fallbackTitle} />
        <div className="computers__actions">
          {thread && (
            <Button
              size="sm"
              variant="secondary"
              aria-pressed={chatOpen}
              leadingIcon={<Icons.MessageCircle size={14} />}
              onClick={() => setChatOpen((o) => !o)}
            >
              {t("computers.chat")}
            </Button>
          )}
          <Button size="sm" loading={busy} onClick={() => void control()}>
            {t(manual ? "computer.returnControl" : "computer.takeControl")}
          </Button>
          <Menu
            align="end"
            trigger={<IconButton size="sm" label={t("common.more")} icon={<Icons.Ellipsis size={14} />} />}
            items={[
              ...(onOff ? [{ label: t("computers.turnOff"), disabled: busyOff, onSelect: onOff }] : []),
              { label: t("computer.stop"), danger: true, onSelect: onStopAll },
            ]}
          />
        </div>
      </div>
      <div className="computers__body">
        <div className="computers__main">
          <div className="computer__desktop">
            <section className="computer__screen" ref={view.screen} aria-label={t("computer.screen")} />
            {!manual && <div className="computer__locked" role="img" aria-label={t("computer.takeControlHint")} />}
          </div>
          {view.error && (
            <div className="computer__error" role="alert">
              {view.error}
            </div>
          )}
        </div>
        {chatOpen && thread && (
          <aside className="computers__chat" aria-label={t("computers.chat")}>
            <div className="computers__chathead">
              <span>{t("computers.chat")}</span>
              <IconButton
                size="sm"
                label={t("computers.openChat")}
                icon={<Icons.Maximize2 size={14} />}
                onClick={() => go.thread(thread)}
              />
              <IconButton
                size="sm"
                label={t("common.close")}
                icon={<Icons.X size={14} />}
                onClick={() => setChatOpen(false)}
              />
            </div>
            <ChatView wideHeader={false} compact threadId={thread} />
          </aside>
        )}
      </div>
    </div>
  );
}

/** Every agent screen in use, as a wall; one opens large. With none, whether the computer is off or idle. */
function ComputersScreenBody() {
  const t = useT();
  const mode = useNav((s) => s.mode);
  const { status, error, setError, refresh } = useComputerStatus();
  const [open, setOpen] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<ComputerMemoryRefusal>();
  const ready = Boolean(status?.ready);
  // Every screen that is up, as the counter and the panel's picker count them: working, idle, or in the owner's hands.
  const inUse = status?.screens ?? [];
  const large = inUse.find((s) => s.screen === open);
  const threads = useData((s) => s.threads);
  const chatOf = (screen: ComputerScreen) => screenChat(status, threads, screen.agent);
  const [screenBusy, setScreenBusy] = useState<string>();
  const [full, setFull] = useState<{ agent: string } & ScreensFull>();
  const agents = useData((s) => s.agents);
  const screenOf = async (agent: string, on: boolean) => {
    setScreenBusy(agent);
    setError("");
    setFull(undefined);
    try {
      await client.call("environments.screen", { agent, on });
      refresh();
    } catch (failure) {
      const cap = screensFull(failure);
      if (cap) setFull({ agent, ...cap });
      else setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setScreenBusy(undefined);
    }
  };
  const power = async (on: boolean, memory?: number, pastReserve = false) => {
    setBusy(true);
    setError("");
    setRefusal(undefined);
    try {
      if (memory !== undefined) await client.call("environments.configure", { memory_gib: memory });
      if (on)
        await client.call("environments.enable", { appearance: mode, ...(pastReserve ? { past_reserve: true } : {}) });
      else await client.call("environments.stop", {});
      refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setRefusal(memoryRefusal(failure));
    } finally {
      setBusy(false);
    }
  };
  const off = (status?.allowed ?? []).filter((id) => agents[id] && !inUse.some((s) => s.agent === id));
  const starting = status?.phase === "preparing" || status?.phase === "stopping";
  return (
    <section className="page computers" aria-label={t("nav.computers")}>
      <ComputerError
        error={error || status?.error || ""}
        refusal={refusal}
        busy={busy}
        onLower={(gib) => void power(true, gib)}
        onAnyway={() => void power(true, undefined, true)}
      />
      {large ? (
        <Large
          screen={large}
          chatOf={chatOf(large)}
          ready={ready}
          busyOff={screenBusy === large.agent}
          onBack={() => setOpen(undefined)}
          onError={setError}
          onOff={
            large.run || !large.agent
              ? undefined
              : () => void screenOf(large.agent ?? "", false).then(() => setOpen(undefined))
          }
          onStopAll={() => void power(false)}
        />
      ) : ready ? (
        <>
          {ready && (
            <header className="computers__bar">
              <span>{t("computers.lead", { held: screensUp(status), max: status?.max_screens ?? 1 })}</span>
              <Button size="sm" variant="secondary" loading={busy} onClick={() => void power(false)}>
                {t("computer.stop")}
              </Button>
            </header>
          )}
          <div className="computers__wall" data-count={inUse.length + off.length}>
            {inUse.map((screen) => (
              <Tile
                key={screen.screen}
                screen={screen}
                title={threads[chatOf(screen) ?? ""]?.title}
                ready={ready}
                busy={screenBusy === screen.agent}
                onOpen={() => setOpen(screen.screen)}
                onOff={screen.run || !screen.agent ? undefined : () => void screenOf(screen.agent ?? "", false)}
              />
            ))}
            {off.map((agent) => (
              <OffTile
                key={agent}
                agent={agent}
                busy={screenBusy === agent}
                full={full?.agent === agent ? full : undefined}
                onOn={() => void screenOf(agent, true)}
              />
            ))}
          </div>
        </>
      ) : (
        <EmptyState
          size="lg"
          icon={<Icons.Monitor />}
          title={t(starting ? "computer.preparing" : "computers.off")}
          action={
            <Button loading={busy || starting} onClick={() => void power(true)}>
              {t("computer.start")}
            </Button>
          }
        >
          {t("computers.offHint")}
        </EmptyState>
      )}
    </section>
  );
}

/** Shown once its strings are loaded: they come with it, not with the first screen. */
export function ComputersScreen() {
  return usePack("computer") ? <ComputersScreenBody /> : null;
}
