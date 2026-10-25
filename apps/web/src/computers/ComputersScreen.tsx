import "../styles/screens.css";
import "../styles/computer.css";
import type { ComputerMemoryRefusal, ComputerScreen, Result } from "@apx/protocol";
import { AgentAvatar, Button, EmptyState, Icons } from "@apx/ui";
import { useEffect, useRef, useState } from "react";
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
type Usage = Result<"environments.usage">;

/** Polled while this view is open: every viewer below lives only as long as the view does. */
function useComputerStatus() {
  const [status, setStatus] = useState<Status>();
  const [usage, setUsage] = useState<Usage>();
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
        // What the VM takes is read from the guest: only while nothing is shown, for the empty state.
        if (next.ready && !next.screens?.some((s) => s.run))
          setUsage(await client.withSignal(abort.signal).call("environments.usage", {}));
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
  return { status, usage, error, setError, refresh: () => now.current() };
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
  onOpen,
}: {
  screen: ComputerScreen;
  title?: string | undefined;
  ready: boolean;
  onOpen(): void;
}) {
  const t = useT();
  const view = useVmDisplay(screen.screen, ready, false, true);
  return (
    <button
      type="button"
      className="computers__tile"
      onClick={onOpen}
      aria-label={t("computers.openScreen", { agent: screen.agent_name ?? "" })}
    >
      <Holder screen={screen} title={title} />
      <div className="computers__thumb">
        <section className="computer__screen" ref={view.screen} aria-label={t("computer.screen")} />
      </div>
    </button>
  );
}

/** One screen large, with its lease and the way to its agent's chat. */
function Large({
  screen,
  chatOf,
  ready,
  onBack,
  onError,
}: {
  screen: ComputerScreen;
  /** Its agent's chat when no run holds it now. */
  chatOf?: string | undefined;
  ready: boolean;
  onBack(): void;
  onError(message: string): void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
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
        {thread && (
          <Button size="sm" variant="secondary" onClick={() => go.thread(thread)}>
            {t("computers.openChat")}
          </Button>
        )}
        <Button size="sm" loading={busy} onClick={() => void control()}>
          {t(manual ? "computer.returnControl" : "computer.takeControl")}
        </Button>
      </div>
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
  );
}

/** Every agent screen in use, as a wall; one opens large. With none, whether the computer is off or idle. */
function ComputersScreenBody() {
  const t = useT();
  const mode = useNav((s) => s.mode);
  const { status, usage, error, setError, refresh } = useComputerStatus();
  const [open, setOpen] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<ComputerMemoryRefusal>();
  const ready = Boolean(status?.ready);
  // Every screen that is up, as the counter and the panel's picker count them: working, idle, or in the owner's hands.
  const inUse = status?.screens ?? [];
  const large = inUse.find((s) => s.screen === open);
  const threads = useData((s) => s.threads);
  const chatOf = (screen: ComputerScreen) => screenChat(status, threads, screen.agent);
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
  const starting = status?.phase === "preparing" || status?.phase === "stopping";
  return (
    <section className="page computers" aria-label={t("nav.computers")}>
      <header className="page__head page__head--row">
        <div>
          <h1 className="page__title">{t("nav.computers")}</h1>
          <p className="page__lead">
            {ready
              ? t("computers.lead", { held: screensUp(status), max: status?.max_screens ?? 1 })
              : t("computers.leadOff")}
          </p>
        </div>
        {ready && (
          <Button variant="secondary" loading={busy} onClick={() => void power(false)}>
            {t("computer.stop")}
          </Button>
        )}
      </header>
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
          onBack={() => setOpen(undefined)}
          onError={setError}
        />
      ) : inUse.length && ready ? (
        <div className="computers__wall" data-count={inUse.length}>
          {inUse.map((screen) => (
            <Tile
              key={screen.screen}
              screen={screen}
              title={threads[chatOf(screen) ?? ""]?.title}
              ready={ready}
              onOpen={() => setOpen(screen.screen)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          size="lg"
          icon={<Icons.Monitor />}
          title={t(ready ? "computers.idle" : starting ? "computer.preparing" : "computers.off")}
          action={
            ready ? undefined : (
              <Button loading={busy || starting} onClick={() => void power(true)}>
                {t("computer.start")}
              </Button>
            )
          }
        >
          {ready && usage?.memory_assigned_mb
            ? t("computers.memory", {
                used: usage.memory_used_mb ?? 0,
                assigned: usage.memory_assigned_mb,
              })
            : t("computers.offHint")}
        </EmptyState>
      )}
    </section>
  );
}

/** Shown once its strings are loaded: they come with it, not with the first screen. */
export function ComputersScreen() {
  return usePack("computer") ? <ComputersScreenBody /> : null;
}
