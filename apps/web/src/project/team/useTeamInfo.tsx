import type { Agent, Run } from "@apx/protocol";
import { Icons } from "@apx/ui";
import { useCallback, useEffect, useMemo } from "react";
import { loadRoutines, useRoutines } from "../../data/routines.ts";
import { useData } from "../../data/state.ts";
import { loadTasks, tasksLoaded, useTasks } from "../../data/tasks.ts";
import { useT } from "../../i18n/index.ts";
import type { NodeInfo } from "./TeamCanvas.tsx";

const LIVE: ReadonlySet<Run["state"]> = new Set(["submitted", "working", "input-required"]);

/**
 * What an agent's own model runs on, for the icon (the whole ref, so "openrouter/anthropic/…" still shows Claude's
 * mark) and the label (its first segment); "inherit" when it uses the install default.
 */
export function engineOf(a: Agent): string {
  return a.harness ?? a.model_choice?.model ?? "inherit";
}
export const engineLabelOf = (engine: string) => engine.split(/[/:]/)[0] ?? engine;

/**
 * What each card shows: live state from runs, counters (chats, open tasks, routines) and the engine; plus the
 * delegations in flight, as "caller>callee" pairs, for the moving dot on the curves.
 */
export function useTeamInfo(leadId: string | undefined, leadLabel: string) {
  const t = useT();
  const threads = useData((s) => s.threads);
  const runs = useData((s) => s.runs);
  const tasks = useTasks((s) => s.tasks);
  const routines = useRoutines((s) => s.routines);
  const routinesReady = useRoutines((s) => s.ready);
  useEffect(() => {
    if (!tasksLoaded()) void loadTasks();
  }, []);
  useEffect(() => {
    if (!routinesReady) void loadRoutines();
  }, [routinesReady]);

  const counts = useMemo(() => {
    const chats = new Map<string, number>();
    // Conversations only: a task's or a routine's thread is counted as that task or routine.
    for (const th of Object.values(threads))
      if (!th.parent_id && th.kind !== "a2a" && th.kind !== "task" && th.kind !== "routine")
        for (const id of th.agent_ids) chats.set(id, (chats.get(id) ?? 0) + 1);
    const open = new Map<string, number>();
    for (const task of Object.values(tasks))
      if (task.state === "open" && task.assignee) open.set(task.assignee, (open.get(task.assignee) ?? 0) + 1);
    const rts = new Map<string, number>();
    for (const r of routines) rts.set(r.agent_id, (rts.get(r.agent_id) ?? 0) + 1);
    return { chats, open, rts };
  }, [threads, tasks, routines]);

  const { status, live } = useMemo(() => {
    const status = new Map<string, NodeInfo["status"]>();
    const live = new Set<string>();
    for (const r of Object.values(runs)) {
      if (!LIVE.has(r.state)) continue;
      const waiting = r.state === "input-required";
      if (waiting || !status.has(r.agent_id)) status.set(r.agent_id, waiting ? "waiting" : "running");
      const caller = r.parent_run_id ? runs[r.parent_run_id] : undefined;
      if (caller && caller.agent_id !== r.agent_id) live.add(`${caller.agent_id}>${r.agent_id}`);
    }
    return { status, live };
  }, [runs]);

  const info = useCallback(
    (a: Agent): NodeInfo => {
      const engine = engineOf(a);
      return {
        status: status.get(a.id) ?? "idle",
        engine,
        engineLabel: engine === "inherit" ? t("team.inherit") : engineLabelOf(engine),
        ...(a.id === leadId ? { lead: leadLabel } : {}),
        stats: [
          { icon: <Icons.MessageSquare />, value: counts.chats.get(a.id) ?? 0, label: t("team.stat.chats") },
          { icon: <Icons.ListChecks />, value: counts.open.get(a.id) ?? 0, label: t("team.stat.tasks") },
          { icon: <Icons.Repeat />, value: counts.rts.get(a.id) ?? 0, label: t("team.stat.routines") },
        ],
      };
    },
    [status, counts, leadId, leadLabel, t],
  );
  return { info, live };
}
