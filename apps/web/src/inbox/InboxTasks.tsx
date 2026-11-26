// The Inbox's Tasks tab: tasks in status sections, ten at a time. A press held on a section's title picks the whole
// section up (every section folds to its title meanwhile) to drop it in another place; Alt+↑/↓ does it from the keyboard.
import "./task-sections.css";
import { Button, Icons, Tooltip } from "@apx/ui";
import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  Suspense,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { setPrefs, usePrefs } from "../data/prefs.ts";
import { useData } from "../data/state.ts";
import { ensureTask, useTasks } from "../data/tasks.ts";
import { useT } from "../i18n/index.ts";
import { TaskBundle } from "../lazy.ts";
import { useNav } from "../shell/nav.ts";
import type { ListEntry } from "./groupThreads.ts";
import { TasksSkeleton } from "./InboxSkeleton.tsx";
import { selectionPath } from "./selectionPath.ts";
import { movedSection, taskSections } from "./taskSections.ts";

type Entry = Extract<ListEntry, { kind: "task" }>;

/** How many tasks a section shows at first, and how many more each "Show more" adds. */
const PAGE = 10;
/** A press held this long on a section's title without wandering picks the section up. */
const HOLD_MS = 350;
/** How far (px) a press may wander and still be a hold. */
const SLOP = 8;

/** While a section is held a finger moves it, not the page. */
const noScroll = (e: TouchEvent) => e.preventDefault();

type Press = { pointer: number; x: number; y: number; index: number; timer: number };
/**
 * A held section: which, where it started and would land, where the pointer is and where on the title it was grabbed;
 * once the folded list is measured, where the pointer started from (`base`), each title's middle and the room one takes.
 */
type Sort = {
  id: string;
  from: number;
  to: number;
  pointerY: number;
  grab: number;
  base?: number;
  mids: number[];
  step: number;
};

/** Where each title sits while one is held: the held one follows the pointer, the ones it passed make room. */
function offset(sort: Sort | undefined, index: number): number {
  if (!sort || sort.base === undefined) return 0;
  if (index === sort.from) return sort.pointerY - sort.base;
  if (sort.from < sort.to && index > sort.from && index <= sort.to) return -sort.step;
  if (sort.to < sort.from && index >= sort.to && index < sort.from) return sort.step;
  return 0;
}

/** Where the held title would land: past every other title whose middle it went beyond. */
function landing(sort: Sort): number {
  if (sort.base === undefined) return sort.from;
  const middle = (sort.mids[sort.from] ?? 0) + sort.pointerY - sort.base;
  return sort.mids.filter((m, j) => j !== sort.from && m < middle).length;
}

export function InboxTasks({ entries }: { entries: Entry[] }) {
  const t = useT();
  const selected = useNav((s) => s.threadId);
  const loaded = useData((s) => s.threads);
  const tasks = useTasks((s) => s.tasks);
  const ready = useTasks((s) => s.ready);
  const order = usePrefs((s) => s.inboxTaskOrder);
  useEffect(() => {
    for (const entry of entries) ensureTask(entry.taskId);
  }, [entries]);
  const path = useMemo(() => selectionPath(loaded, selected), [loaded, selected]);
  const groups = useMemo(() => taskSections(entries, tasks, order), [entries, tasks, order]);
  const ids = groups.map((g) => g.id);

  const wrap = useRef<HTMLDivElement>(null);
  const press = useRef<Press>(undefined);
  const [sort, setSortState] = useState<Sort>();
  const sorting = useRef<Sort>(undefined);
  const swallow = useRef(false);
  const setSort = (next: Sort | undefined) => {
    sorting.current = next;
    setSortState(next);
  };

  // Once every section has folded to its title, the titles are measured where they now are.
  const measuring = sort !== undefined && sort.base === undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: it reads the held section from its ref, once per fold
  useLayoutEffect(() => {
    const s = sorting.current;
    if (!measuring || !s) return;
    const rects = [...(wrap.current?.querySelectorAll<HTMLElement>(":scope > .inboxsec") ?? [])].map((el) =>
      el.getBoundingClientRect(),
    );
    const held = rects[s.from];
    if (!held) return;
    const gap = rects.length > 1 ? Math.max(0, (rects[1]?.top ?? 0) - (rects[0]?.bottom ?? 0)) : 0;
    const next = {
      ...s,
      base: held.top + s.grab,
      mids: rects.map((r) => r.top + r.height / 2),
      step: held.height + gap,
    };
    setSort({ ...next, to: landing(next) });
  }, [measuring]);

  const stop = () => {
    const p = press.current;
    if (p) clearTimeout(p.timer);
    press.current = undefined;
    document.removeEventListener("touchmove", noScroll);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: only on leaving, whatever press is still pending
  useEffect(() => stop, []);

  const pickUp = (heading: HTMLElement, p: Press) => {
    const id = ids[p.index];
    if (!id) return;
    try {
      heading.setPointerCapture(p.pointer);
    } catch {
      // The pointer is already gone: nothing to hold.
      press.current = undefined;
      return;
    }
    getSelection()?.removeAllRanges();
    navigator.vibrate?.(10);
    document.addEventListener("touchmove", noScroll, { passive: false });
    const grab = p.y - heading.getBoundingClientRect().top;
    setSort({ id, from: p.index, to: p.index, pointerY: p.y, grab, mids: [], step: 0 });
  };
  const place = (id: string, to: number) => {
    const others = ids.filter((x) => x !== id);
    setPrefs({ inboxTaskOrder: movedSection(order, id, others[to], others.at(-1)) });
  };

  const down = (e: PointerEvent<HTMLElement>, index: number) => {
    if (ids.length < 2 || e.button !== 0 || press.current) return;
    const heading = e.currentTarget;
    const p: Press = { pointer: e.pointerId, x: e.clientX, y: e.clientY, index, timer: 0 };
    p.timer = window.setTimeout(() => pickUp(heading, p), HOLD_MS);
    press.current = p;
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const p = press.current;
    if (!p || e.pointerId !== p.pointer) return;
    const s = sorting.current;
    if (s) {
      const next = { ...s, pointerY: e.clientY };
      setSort({ ...next, to: landing(next) });
    } else if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLOP) stop();
  };
  const letGo = (keep: boolean) => {
    const s = sorting.current;
    stop();
    if (!s) return;
    setSort(undefined);
    // The click that ends the hold neither folds nor unfolds the section.
    swallow.current = true;
    setTimeout(() => {
      swallow.current = false;
    }, 300);
    if (keep && s.to !== s.from) place(s.id, s.to);
  };
  const keys = (e: KeyboardEvent<HTMLElement>, index: number) => {
    const to = e.key === "ArrowUp" ? index - 1 : e.key === "ArrowDown" ? index + 1 : -1;
    const id = ids[index];
    if (!e.altKey || !id || to < 0 || to >= ids.length) return;
    e.preventDefault();
    const focused = document.activeElement as HTMLElement | null;
    place(id, to);
    requestAnimationFrame(() => focused?.focus());
  };

  // Until the tasks are read their sections are unknown: rows sketched, never an empty or shuffling list.
  if (!ready) return <TasksSkeleton />;
  return (
    <Suspense fallback={<TasksSkeleton />}>
      <div ref={wrap} className={`inboxtasks${sort ? " is-sorting" : ""}`}>
        {groups.map((group, i) => (
          <TaskSection
            key={group.id}
            label={t(`inbox.taskSections.${group.id}`)}
            entries={group.entries}
            selected={selected}
            revealAt={group.entries.findIndex(
              (e) => e.threads.some((th) => path.has(th.id)) || tasks[e.taskId]?.thread_id === selected,
            )}
            folded={Boolean(sort)}
            held={sort?.from === i}
            dy={offset(sort, i)}
            heading={{
              onPointerDown: (e) => down(e, i),
              onPointerMove: move,
              onPointerUp: () => letGo(true),
              onPointerCancel: () => letGo(false),
              onKeyDown: (e) => keys(e, i),
              onClickCapture: (e) => {
                if (!swallow.current) return;
                e.preventDefault();
                e.stopPropagation();
              },
            }}
          />
        ))}
      </div>
    </Suspense>
  );
}

type HeadingHandlers = {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  onClickCapture: (e: MouseEvent<HTMLElement>) => void;
};

function TaskSection({
  label,
  entries,
  selected,
  revealAt,
  folded,
  held,
  dy,
  heading,
}: {
  label: string;
  entries: Entry[];
  selected: string | undefined;
  /** Where the chat on screen is in this section (-1: not here): the section opens and shows it. */
  revealAt: number;
  /** A section is being moved: every one shows only its title. */
  folded: boolean;
  held: boolean;
  dy: number;
  heading: HeadingHandlers;
}) {
  const t = useT();
  const id = useId();
  const [closed, setClosed] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const at = useRef(revealAt);
  at.current = revealAt;
  const reveal = revealAt >= 0 ? selected : undefined;
  useEffect(() => {
    if (!reveal) return;
    setClosed(false);
    setShown((n) => Math.max(n, Math.ceil((at.current + 1) / PAGE) * PAGE));
  }, [reveal]);
  const more = entries.length - Math.min(shown, entries.length);
  return (
    <section
      className={`inboxsec${held ? " is-held" : ""}${folded && !held ? " is-moving" : ""}`}
      aria-label={label}
      style={dy ? { transform: `translateY(${dy}px)` } : undefined}
    >
      <h2 className="inboxsec__heading" {...heading}>
        <Button
          variant="ghost"
          size="sm"
          className="inboxsec__tasktoggle"
          aria-expanded={!closed}
          aria-controls={id}
          leadingIcon={
            closed ? <Icons.ChevronRight size={12} aria-hidden /> : <Icons.ChevronDown size={12} aria-hidden />
          }
          onClick={() => setClosed(!closed)}
        >
          <span>{label}</span>
          <Tooltip content={t("inbox.taskSections.count")}>
            <span className="inboxsec__count">{entries.length}</span>
          </Tooltip>
        </Button>
      </h2>
      <div id={id} className="inboxsec__tasks" hidden={closed || folded}>
        {entries.slice(0, shown).map((e) => (
          <TaskBundle key={e.taskId} taskId={e.taskId} threads={e.threads} selected={selected} />
        ))}
        {more > 0 && (
          <Button variant="link" size="sm" className="inboxsec__more" onClick={() => setShown((n) => n + PAGE)}>
            {t("inbox.showMore", { n: Math.min(PAGE, more) })}
          </Button>
        )}
      </div>
    </section>
  );
}
