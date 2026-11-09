import "../styles/screens.css";
import "./RoutineChat.css";
import type { Agent, Routine, RoutineRun } from "@apx/protocol";
import {
  AgentAvatar,
  Button,
  EmptyState,
  IconButton,
  Icons,
  Menu,
  Skeleton,
  StickyScroll,
  type StickyScrollHandle,
  Tag,
} from "@apx/ui";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChatComposer } from "../chat/composer/ChatComposer.tsx";
import { loadThread } from "../data/actions.ts";
import { client } from "../data/client.ts";
import { blobOf } from "../data/identity.ts";
import { draftOf, loadRoutines, routinesLoaded, useRoutines } from "../data/routines.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { PanelSwitcher } from "../panel/PanelSwitcher.tsx";
import { go, useNav } from "../shell/nav.ts";
import { RoutineDrawer } from "./RoutineDrawer.tsx";
import { RoutineEditor } from "./RoutineEditor.tsx";
import { RunBlock } from "./RunBlock.tsx";
import { RunRail } from "./RunRail.tsx";
import { scheduleText } from "./Schedule.tsx";

/** Runs shown at first and added each time the reader reaches the top. */
const PAGE = 6;
/** The most runs the core lists for one routine. */
const MAX_RUNS = 200;

/** The element that scrolls a StickyScroll: its content's parent. */
const scrollerOf = (h: StickyScrollHandle | null) => h?.content()?.parentElement ?? null;

/** A routine's runs, oldest first, read again whenever its latest run starts or ends. */
function useRoutineRuns(r: Routine | undefined): RoutineRun[] | undefined {
  const [runs, setRuns] = useState<{ id: string; list: RoutineRun[] }>();
  const id = r?.id;
  const latest = `${r?.last?.run_id}:${r?.last?.state}:${r?.last?.delivered}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: read again whenever the latest run starts or ends
  useEffect(() => {
    if (!id) return;
    let live = true;
    client
      .call("routines.runs", { routine: id, limit: MAX_RUNS })
      .then(({ runs }) => live && setRuns({ id, list: [...runs].reverse() }))
      .catch(() => live && setRuns({ id, list: [] }));
    return () => {
      live = false;
    };
  }, [id, latest]);
  return runs && runs.id === id ? runs.list : undefined;
}

/**
 * Every run of one routine as one chat: each run after the one before, with when it ran and how it ended between them,
 * a timeline of runs on the edge, and a composer that writes in the latest run (the only one still open).
 */
export function RoutineChat({
  routineId,
  wideHeader,
  compact = false,
}: {
  routineId: string;
  wideHeader: boolean;
  compact?: boolean;
}) {
  const t = useT();
  const ready = useRoutines((s) => s.ready);
  const routine = useRoutines((s) => s.routines.find((r) => r.id === routineId));
  useEffect(() => {
    if (!routinesLoaded()) void loadRoutines();
  }, []);
  const runs = useRoutineRuns(routine);
  if (!ready || (routine && !runs)) return <RoutineChatSkeleton />;
  if (!routine || !runs) {
    return (
      <section className="chat chat--empty">
        <EmptyState
          size="lg"
          icon={<Icons.TriangleAlert />}
          title={t("routineChat.notFound.title")}
          {...(compact
            ? {
                action: (
                  <Button size="sm" variant="secondary" onClick={go.showList}>
                    {t("chat.toList")}
                  </Button>
                ),
              }
            : {})}
        >
          {t("routineChat.notFound.body")}
        </EmptyState>
      </section>
    );
  }
  return <RoutineRuns key={routine.id} routine={routine} runs={runs} wide={wideHeader} compact={compact} />;
}

function RoutineRuns({
  routine,
  runs,
  wide,
  compact,
}: {
  routine: Routine;
  runs: RoutineRun[];
  wide: boolean;
  compact: boolean;
}) {
  const t = useT();
  const agent = useData((s) => s.agents[routine.agent_id] ?? s.former[routine.agent_id]);
  const latest = runs.at(-1);
  const latestThread = useData((s) => (latest ? s.threads[latest.thread_id] : undefined));
  const [count, setCount] = useState(PAGE);
  const [active, setActive] = useState(runs.length - 1);
  const scroll = useRef<StickyScrollHandle>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const pendingJump = useRef<number | undefined>(undefined);
  const hold = useRef<number | undefined>(undefined);
  const first = Math.max(0, runs.length - count);
  const opened = useFirstRuns(runs);

  // Reaching the top shows the runs before; the browser keeps the reader's place as they are added above.
  const more = first > 0;
  useEffect(() => {
    const el = sentinel.current;
    const root = scrollerOf(scroll.current);
    if (!opened || !more || !el || !root) return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setCount((c) => c + PAGE), {
      root,
      rootMargin: "300px 0px 0px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [opened, more]);

  // The run at the top of the view is the one the timeline marks; at the end, the latest.
  useEffect(() => {
    const sc = scrollerOf(scroll.current);
    if (!opened || !sc) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top = sc.getBoundingClientRect().top;
        let cur = first;
        for (const el of sc.querySelectorAll<HTMLElement>("[data-run]"))
          if (el.getBoundingClientRect().top - top <= 80) cur = Number(el.dataset.run);
        if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4) cur = runs.length - 1;
        setActive(cur);
      });
    };
    sc.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      sc.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [opened, first, runs.length]);

  const scrollTo = (i: number, behavior: ScrollBehavior) => {
    const sc = scrollerOf(scroll.current);
    const el = sc?.querySelector<HTMLElement>(`[data-run="${i}"]`);
    if (!sc || !el) return;
    scroll.current?.release();
    const top = sc.scrollTop + el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 12;
    sc.scrollTo({ top, behavior });
  };
  const jump = (i: number) => {
    hold.current = undefined;
    setActive(i);
    if (i >= first) return scrollTo(i, "smooth");
    // An older run is not shown yet: show it and a page before it (so the top stays out of reach), then go to it.
    pendingJump.current = i;
    setCount(runs.length - i + PAGE);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once the runs a jump asked for are shown
  useLayoutEffect(() => {
    const i = pendingJump.current;
    if (i == null) return;
    pendingJump.current = undefined;
    hold.current = i;
    scrollTo(i, "instant");
  }, [first]);
  // The runs above a jump's run are still being read: keep that run in place until the reader scrolls on their own.
  // biome-ignore lint/correctness/useExhaustiveDependencies: set up once the scroll is open
  useEffect(() => {
    const sc = scrollerOf(scroll.current);
    const content = scroll.current?.content();
    if (!opened || !sc || !content) return;
    const ro = new ResizeObserver(() => hold.current != null && scrollTo(hold.current, "instant"));
    ro.observe(content);
    const letGo = () => {
      hold.current = undefined;
    };
    const events = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
    for (const e of events) sc.addEventListener(e, letGo, { passive: true });
    return () => {
      ro.disconnect();
      for (const e of events) sc.removeEventListener(e, letGo);
    };
  }, [opened]);

  const sub = t("routineChat.sub", {
    schedule: scheduleText(routine.schedule, t),
    runs: runs.length === 1 ? t("routineChat.runsOne") : t("routineChat.runsMany", { n: runs.length }),
  });
  // The scroll opens once the latest runs are read, so it starts at the end like any chat.
  if (!opened) return <RoutineChatSkeleton />;
  return (
    <section className="chat rtchat" aria-label={routine.name}>
      <RoutineHeader routine={routine} agent={agent} sub={sub} wide={wide} compact={compact} />
      <div className="rtchat__body">
        <StickyScroll
          ref={scroll}
          resetKey={routine.id}
          toBottomLabel={t("chat.toBottom")}
          className="chat__scroll rtchat__scroll"
          contentClassName="rtchat__runs"
        >
          {more && <div ref={sentinel} className="rtchat__more" aria-hidden="true" />}
          {runs.length === 0 && (
            <EmptyState icon={<Icons.Clock />} title={t("routineChat.empty.title")}>
              {t("routineChat.empty.body")}
            </EmptyState>
          )}
          {runs.slice(first).map((run, k) => (
            <RunBlock key={run.run_id} run={run} index={first + k} routine={routine} previous={runs[first + k - 1]} />
          ))}
        </StickyScroll>
        <RunRail runs={runs} action={routine.action} active={active} onJump={jump} />
      </div>
      {latestThread && (
        <ChatComposer
          key={latestThread.id}
          thread={latestThread}
          agent={agent}
          placeholder={t("routineChat.placeholder", { name: agent?.name ?? "" })}
        />
      )}
    </section>
  );
}

/** Reads the latest runs' threads; true once they are read (and stays true as new runs arrive). */
function useFirstRuns(runs: RoutineRun[]): boolean {
  const ready = useData((s) => s.ready);
  const ids = runs.slice(-PAGE).map((r) => r.thread_id);
  const pending = useData((s) => ids.filter((id) => s.threadLoad[id] == null).join(" "));
  const done = useData((s) => ids.every((id) => s.threadLoad[id] === "ready" || s.threadLoad[id] === "error"));
  const [opened, setOpened] = useState(false);
  if (ready && done && !opened) setOpened(true);
  useEffect(() => {
    if (!ready || !pending) return;
    for (const id of pending.split(" ")) void loadThread(id);
  }, [ready, pending]);
  return opened;
}

function RoutineHeader({
  routine,
  agent,
  sub,
  wide,
  compact,
}: {
  routine: Routine;
  agent: Agent | undefined;
  sub: string;
  wide: boolean;
  compact: boolean;
}) {
  const t = useT();
  const tools = useNav((s) => s.tools);
  const [editing, setEditing] = useState(false);
  const [shown, setShown] = useState(false);
  return (
    <header className={compact ? "chat__header chat__header--compact" : "chat__header"}>
      {compact && (
        <IconButton size="sm" label={t("chat.toList")} icon={<Icons.ArrowLeft size={14} />} onClick={go.showList} />
      )}
      <AgentAvatar name={agent?.name ?? routine.name} blob={blobOf(agent)} size={32} />
      <div className="chat__titles">
        <div className="chat__title">
          <span className="chat__name">{routine.name}</span>
          {!routine.enabled && <Tag>{t("routineChat.paused")}</Tag>}
        </div>
        <div className="chat__crumb">
          <span className="rtchat__sub">{sub}</span>
        </div>
      </div>
      <div className="chat__tools">
        <Button
          size="sm"
          variant="secondary"
          className={shown ? "chat__taskbtn is-on" : "chat__taskbtn"}
          aria-pressed={shown}
          leadingIcon={<Icons.RefreshCw size={14} />}
          onClick={() => setShown(!shown)}
        >
          {t(shown ? "routineChat.hide" : "routineChat.show")}
        </Button>
        <Menu
          align="end"
          trigger={<IconButton size="sm" label={t("chat.more")} icon={<Icons.Ellipsis size={14} />} />}
          items={[
            { label: t("routines.edit"), icon: <Icons.Pencil size={14} />, onSelect: () => setEditing(true) },
            {
              label: t("chat.showTools"),
              icon: <Icons.Wrench size={14} />,
              checked: tools,
              keepOpen: true,
              onSelect: go.toggleTools,
            },
          ]}
        />
        <span className="chat__toolsdiv" />
        <PanelSwitcher wide={wide} skipUsage />
      </div>
      {shown && (
        <RoutineDrawer
          routine={routine}
          agentName={agent?.name ?? routine.agent_id}
          peek
          onEdit={() => setEditing(true)}
          onClose={() => setShown(false)}
        />
      )}
      {editing && <RoutineEditor draft={draftOf(routine)} onClose={() => setEditing(false)} />}
    </header>
  );
}

function RoutineChatSkeleton() {
  return (
    <section className="chat" aria-busy="true">
      <div className="chat__header">
        <Skeleton shape="circle" width={32} />
        <Skeleton width={180} />
      </div>
      <div className="chat__scroll">
        <div className="transcript">
          <Skeleton width="50%" height={14} style={{ alignSelf: "center" }} />
          <Skeleton width="70%" height={64} shape="block" />
          <Skeleton width="50%" height={14} style={{ alignSelf: "center" }} />
          <Skeleton width="55%" height={44} shape="block" />
        </div>
      </div>
    </section>
  );
}
