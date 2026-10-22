// Live link to the core: one socket, events folded into the store, refetch on reconnect or seq gap.
import type { CoreEvent, EventFrame } from "@apx/protocol";
import type { ApxSocket } from "@apx/protocol/client";
import { t } from "../i18n/index.ts";
import { documentToOpen } from "../panel/documents.ts";
import { go, nav } from "../shell/nav.ts";
import { bootstrap, refetchLoaded } from "./actions.ts";
import { client } from "./client.ts";
import { jobsChanged } from "./jobs.ts";
import { loadNotifications, notificationChanged } from "./notifications.ts";
import { denied } from "./pairing.ts";
import { routineRunChanged } from "./routines.ts";
import { data, upsertMessage } from "./state.ts";
import { loadTasks, taskChanged, taskDeleted, tasksLoaded } from "./tasks.ts";
import { teamChanged } from "./team.ts";
import { forgetThreads } from "./threadAdmin.ts";
import { needsPairing } from "./token.ts";
import { loadUpdates, notePanel } from "./updates.ts";

const RETRY_MS = [1000, 2000, 4000, 8000, 15000];

let started = false;
let socket: ApxSocket | undefined;
let attempt = 0;
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let refetchTimer: ReturnType<typeof setTimeout> | undefined;
const lastSeq = new Map<string, number>();

export function startLive(): void {
  if (started) return;
  started = true;
  void connect();
  // Coming back to the window (e.g. from the terminal) reloads everything, in case an event was missed.
  window.addEventListener("focus", () => {
    if (data.get().connection === "online") scheduleRefetch();
  });
}

/** Offline banner's "Retry": skip the backoff wait. */
export function retryNow(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  attempt = 0;
  const old = socket;
  socket = undefined;
  void connect();
  old?.close();
}

async function connect(): Promise<void> {
  const gen = ++generation;
  // While retrying keep "offline" (and its banner) until a connection actually succeeds.
  if (data.get().connection !== "offline") data.set({ connection: "connecting" });
  let s: ApxSocket | undefined;
  try {
    // The health probe fails fast when the core is down; the socket alone can wait for its full timeout. A refused
    // socket says nothing of why: the probe's error does (a revoked token shows the pairing gate).
    const probe = client.call("system.health", {});
    const [sock, health] = await Promise.all([
      client.connect().catch(async (e: unknown) => {
        await probe;
        throw e;
      }),
      probe,
    ]);
    s = sock;
    notePanel(health);
    if (gen !== generation) return s.close();
    socket = s;
    lastSeq.clear();
    s.onEvent(onFrame);
    // Subscribe first, then read: nothing that happens in between is lost.
    await bootstrap();
    await refetchLoaded();
    void loadNotifications();
    void loadUpdates();
    if (tasksLoaded()) void loadTasks();
    routineRunChanged();
    data.set({ connection: "online", error: undefined });
    attempt = 0;
    await s.closed;
    if (gen !== generation) return;
    data.set({ connection: "offline", error: t("offline.lost") });
  } catch (e) {
    s?.close();
    if (gen !== generation) return;
    if (needsPairing(e)) return denied();
    data.set({ connection: "offline", error: e instanceof Error ? e.message : String(e) });
  }
  schedule();
}

function schedule(): void {
  if (timer) return;
  const wait = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)] ?? 15000;
  attempt++;
  timer = setTimeout(() => {
    timer = undefined;
    void connect();
  }, wait);
}

/** Views that follow a stream of their own (a terminal's output, a chat's commands) without going through the store. */
const watchers = new Set<(ev: CoreEvent) => void>();
export function watchEvents(listener: (ev: CoreEvent) => void): () => void {
  watchers.add(listener);
  return () => watchers.delete(listener);
}

function onFrame(frame: EventFrame): void {
  const prev = lastSeq.get(frame.stream);
  lastSeq.set(frame.stream, frame.seq);
  if (prev != null && frame.seq !== prev + 1) scheduleRefetch();
  if (frame.stream !== "core") return;
  // The core built and validated the event; an unknown type (a newer core) falls through apply's switch.
  const ev = frame.payload as CoreEvent | undefined;
  if (ev && typeof ev === "object" && typeof ev.type === "string") {
    apply(ev);
    for (const w of watchers) w(ev);
  }
}

function scheduleRefetch(): void {
  if (refetchTimer) return;
  refetchTimer = setTimeout(() => {
    refetchTimer = undefined;
    void bootstrap()
      .then(refetchLoaded)
      .catch(() => {});
  }, 300);
}

function apply(ev: CoreEvent): void {
  switch (ev.type) {
    case "thread.updated":
      data.set((s) => ({ threads: { ...s.threads, [ev.thread.id]: ev.thread } }));
      return;
    case "thread.deleted":
      forgetThreads([ev.thread_id, ...ev.children]);
      return;
    case "message.created":
    case "message.updated": {
      const m = ev.message;
      data.set((s) => {
        const list = s.messages[m.thread_id];
        if (!list) return {};
        // The real user message replaces its optimistic copy.
        const text = m.author.kind === "user" && m.parts[0]?.type === "text" ? m.parts[0].text : undefined;
        const base =
          text == null
            ? list
            : list.filter(
                (x) => !(x.id.startsWith("local_") && x.parts[0]?.type === "text" && x.parts[0].text === text),
              );
        return { messages: { ...s.messages, [m.thread_id]: upsertMessage(base, m) } };
      });
      return;
    }
    case "message.deleted": {
      const gone = new Set(ev.message_ids);
      data.set((s) => {
        const list = s.messages[ev.thread_id];
        return list ? { messages: { ...s.messages, [ev.thread_id]: list.filter((m) => !gone.has(m.id)) } } : {};
      });
      return;
    }
    case "message.part":
      data.set((s) => {
        const list = s.messages[ev.thread_id];
        const cur = list?.find((m) => m.id === ev.message_id);
        if (!list || !cur) {
          // A part for a message we have not seen: the next refetch brings it whole.
          if (list) scheduleRefetch();
          return {};
        }
        const parts = [...cur.parts];
        parts[ev.index] = ev.part;
        return { messages: { ...s.messages, [ev.thread_id]: upsertMessage(list, { ...cur, parts }) } };
      });
      {
        const document = documentToOpen(ev, nav.get().threadId);
        if (document) go.document(document.media_id);
      }
      return;
    case "run.updated":
      data.set((s) => ({ runs: { ...s.runs, [ev.run.id]: ev.run } }));
      jobsChanged();
      if (ev.run.trigger === "routine") routineRunChanged();
      return;
    case "job.updated":
      jobsChanged();
      return;
    case "task.updated":
      taskChanged(ev.task);
      return;
    case "task.deleted":
      taskDeleted(ev.task_id);
      return;
    case "notification.updated":
      notificationChanged(ev.notification);
      return;
    case "surface.updated":
      data.set((s) => ({ surfaces: { ...s.surfaces, [ev.surface.id]: ev.surface } }));
      return;
    case "surface.deleted":
      data.set((s) => {
        const { [ev.surface_id]: _gone, ...surfaces } = s.surfaces;
        return { surfaces };
      });
      return;
    case "surface.state":
      data.set((s) =>
        ev.surface_id in s.surfaceStates ? { surfaceStates: { ...s.surfaceStates, [ev.surface_id]: ev.state } } : s,
      );
      return;
    case "team.updated":
      teamChanged();
      return;
    case "browser.tabs":
      // The core checks a node's tabs before pushing them.
      data.set({ tabs: ev.tabs });
      return;
  }
}
