import type { ComputerMemoryRefusal, Result } from "@apx/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { memoryRefusal } from "../computers/refusal.ts";
import { computersOf } from "../computers/summary.ts";
import { client } from "../data/client.ts";
import { data } from "../data/state.ts";
import { useNav } from "../shell/nav.ts";

type Status = Result<"environments.status">;
export type ComputerAction = "enable" | "allow" | "anyway" | "stop" | "leave" | "human" | "agent";

/** The shared computer as the chat in view sees it, polled; `screen` is the one shown: the chat agent's, or one picked. */
export function useComputer(thread: string | undefined) {
  const mode = useNav((s) => s.mode);
  const [status, setStatus] = useState<Status>();
  const [error, setError] = useState("");
  /** A start refused for want of memory, said from its numbers. */
  const [refusal, setRefusal] = useState<ComputerMemoryRefusal>();
  /** What the panel shows in its place (a settings save's failure, or nothing). */
  const report = useCallback((message: string) => {
    setError(message);
    setRefusal(undefined);
  }, []);
  const last = useRef<ComputerAction>("enable");
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<number>();
  const generation = useRef(0);
  const operating = useRef(false);
  const activeThread = useRef(thread);
  const keep = useCallback((result: Status) => {
    setStatus(result);
    data.set({ vmThreads: result.chats ?? [], computers: computersOf(result) });
  }, []);
  useEffect(() => {
    if (activeThread.current !== thread) {
      setStatus(undefined);
      setError("");
      setRefusal(undefined);
      setPicked(undefined);
    }
    activeThread.current = thread;
    setBusy(false);
    generation.current++;
    return () => {
      generation.current++;
    };
  }, [thread]);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const observed = generation.current;
      try {
        if (operating.current) return;
        const viewed = activeThread.current;
        const result = await client
          .withSignal(abort.signal)
          .call("environments.status", viewed ? { thread: viewed } : {});
        if (!abort.signal.aborted && observed === generation.current) keep(result);
      } catch (failure) {
        if (!abort.signal.aborted && observed === generation.current)
          setError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(() => void poll(), 2500);
      }
    };
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [keep]);
  useEffect(() => {
    if (!status?.ready || status.phase === "stopping") return;
    const abort = new AbortController();
    void client
      .withSignal(abort.signal)
      .call("environments.appearance", { appearance: mode })
      .catch((failure: unknown) => {
        if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure));
      });
    return () => abort.abort();
  }, [mode, status?.ready, status?.phase]);
  const screens = status?.screens ?? [];
  const own = status?.chat?.screen;
  // A chat the computer does not serve (Home) starts it without going on it.
  const served = Boolean(status?.chat);
  const screen =
    picked !== undefined && screens.some((s) => s.screen === picked)
      ? picked
      : own !== undefined && screens.some((s) => s.screen === own)
        ? own
        : undefined;
  const operate = useCallback(
    async (action: ComputerAction) => {
      if (!thread || operating.current) return;
      operating.current = true;
      const observed = ++generation.current;
      if (action === "allow" || action === "enable") last.current = action;
      setBusy(true);
      setError("");
      setRefusal(undefined);
      try {
        if (action === "allow" && status?.chat?.agent)
          await client.call("environments.permit", { agent: status.chat.agent, on: true });
        const on = served ? { thread } : {};
        if (action === "allow" || action === "enable")
          await client.call("environments.enable", { ...on, appearance: mode });
        // The owner's own choice to start it with less memory left for the Mac than the reserve.
        else if (action === "anyway")
          await client.call("environments.enable", { ...on, appearance: mode, past_reserve: true });
        else if (action === "stop") await client.call("environments.stop", {});
        else if (action === "leave") await client.call("environments.release", { thread });
        else if (screen !== undefined) await client.call("environments.control", { screen, mode: action });
      } catch (failure) {
        if (observed === generation.current) {
          setError(failure instanceof Error ? failure.message : String(failure));
          setRefusal(memoryRefusal(failure));
        }
      } finally {
        try {
          const result = await client.call("environments.status", { thread });
          if (observed === generation.current) keep(result);
        } catch {}
        operating.current = false;
        if (observed === generation.current) setBusy(false);
      }
    },
    [thread, served, mode, status?.chat?.agent, screen, keep],
  );
  /** The VM's memory lowered to what fits now, and the refused start tried again. */
  const lower = useCallback(
    async (gib: number) => {
      try {
        await client.call("environments.configure", { memory_gib: gib });
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
        return;
      }
      await operate(last.current);
    },
    [operate],
  );
  const refresh = useCallback(async () => {
    keep(await client.call("environments.status", thread ? { thread } : {}));
  }, [thread, keep]);
  return { status, error, refusal, setError: report, busy, operate, lower, refresh, screen, pick: setPicked };
}
