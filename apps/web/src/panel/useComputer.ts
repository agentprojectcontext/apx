import type { Result } from "@apx/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "../data/client.ts";
import { data } from "../data/state.ts";
import { useNav } from "../shell/nav.ts";

export function useComputer(thread: string | undefined) {
  const mode = useNav((s) => s.mode);
  const [status, setStatus] = useState<Result<"environments.status">>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const operating = useRef(false);
  const activeThread = useRef(thread);
  useEffect(() => {
    if (activeThread.current !== thread) {
      setStatus(undefined);
      setError("");
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
        const result = await client.withSignal(abort.signal).call("environments.status", {});
        if (!abort.signal.aborted && observed === generation.current) {
          setStatus(result);
          data.set({ vmThread: result.thread ?? null });
        }
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
  }, []);
  useEffect(() => {
    if (!thread || status?.thread !== thread || status?.phase === "stopping") return;
    const abort = new AbortController();
    void client
      .withSignal(abort.signal)
      .call("environments.appearance", { thread, appearance: mode })
      .catch((failure: unknown) => {
        if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure));
      });
    return () => abort.abort();
  }, [thread, mode, status?.thread, status?.phase]);
  const operate = useCallback(
    async (method: "environments.enable" | "environments.stop" | "human" | "agent") => {
      if (!thread || operating.current) return;
      operating.current = true;
      const observed = ++generation.current;
      setBusy(true);
      setError("");
      try {
        if (method === "environments.enable") await client.call(method, { thread, appearance: mode });
        else if (method === "human" || method === "agent")
          await client.call("environments.control", { thread, mode: method });
        else await client.call(method, { thread });
        const result = await client.call("environments.status", {});
        if (observed === generation.current) {
          setStatus(result);
          data.set({ vmThread: result.thread ?? null });
        }
      } catch (failure) {
        if (observed === generation.current) setError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        operating.current = false;
        if (observed === generation.current) setBusy(false);
      }
    },
    [thread, mode],
  );
  return { status, error, setError, busy, operate };
}
