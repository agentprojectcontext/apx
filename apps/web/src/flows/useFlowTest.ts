// The editor's test with a real event (DECISIONS.md#d-178): it saves the drawing, asks what it may do for the owner,
// then waits for one event (a webhook Flow) or runs once now (a schedule one), and follows the run as the core says it
// moves. The run's steps come from `flows.run_get`; the core's events carry ids and states only.
import { ApxError } from "@apx/protocol/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "../data/client.ts";
import { useFlowRunMoved, useFlowTestHeard } from "../data/flowTests.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { issueText, loadRun, type RunDetail } from "./data.ts";
import { approveOutward } from "./outward.tsx";

export type TestState =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "listening"; until: number }
  | { phase: "running"; event: string }
  | { phase: "done"; event: string | null; said: MessageKey };

export function useFlowTest(o: {
  flow: string | undefined;
  /** Saves what is drawn when it needs saving; the Flow's id, or undefined when it can't be tested yet. */
  prepare: () => Promise<string | undefined>;
  /** What to tell the owner in the top bar. */
  say: (text: string, error?: boolean) => void;
}) {
  const t = useT();
  const [state, setState] = useState<TestState>({ phase: "idle" });
  const [run, setRun] = useState<RunDetail>();
  const flowRef = useRef(o.flow);
  flowRef.current = o.flow;
  const heard = useFlowTestHeard(o.flow);
  const moved = useFlowRunMoved(o.flow);
  const event = state.phase === "running" || state.phase === "done" ? state.event : null;
  // One read at a time; a move while one is out reads again after it.
  const reading = useRef<{ busy: boolean; again: boolean }>({ busy: false, again: false });
  const read = useCallback((flow: string, id: string) => {
    if (reading.current.busy) {
      reading.current.again = true;
      return;
    }
    reading.current = { busy: true, again: false };
    void loadRun(flow, id)
      .then(
        (d) => {
          setRun(d);
          if (d.state !== "pending")
            setState((s) =>
              s.phase === "running" && s.event === id
                ? { phase: "done", event: id, said: `flow.test.end.${d.state}` as MessageKey }
                : s,
            );
        },
        () => undefined,
      )
      .finally(() => {
        const again = reading.current.again;
        reading.current = { busy: false, again: false };
        if (again) read(flow, id);
      });
  }, []);
  // The test's own news: an event in, out of time, stopped elsewhere, refused.
  // biome-ignore lint/correctness/useExhaustiveDependencies: each new word from the core is read once
  useEffect(() => {
    if (!heard || !o.flow) return;
    if (heard.state === "received" && heard.event) {
      setRun(undefined);
      setState({ phase: "running", event: heard.event });
      read(o.flow, heard.event);
    } else if (state.phase === "listening" && heard.state === "expired") {
      setState({ phase: "idle" });
      o.say(t("flow.test.expired"));
    } else if (state.phase === "listening" && heard.state === "stopped") setState({ phase: "idle" });
    else if (state.phase === "listening" && heard.state === "refused")
      setState({ phase: "done", event: null, said: "flow.test.refused" });
  }, [heard?.seq]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: each move of this run reads it again
  useEffect(() => {
    if (moved && o.flow && event && moved.event === event) read(o.flow, event);
  }, [moved?.seq]);
  // A safety net while a run goes: a missed word from the core still ends here.
  useEffect(() => {
    if (state.phase !== "running" || !o.flow) return;
    const flow = o.flow;
    const timer = setInterval(() => read(flow, state.phase === "running" ? state.event : ""), 3000);
    return () => clearInterval(timer);
  }, [state, o.flow, read]);
  // Leaving the editor stops waiting: nobody would be watching.
  const listening = state.phase === "listening";
  useEffect(() => {
    if (!listening) return;
    return () => {
      const flow = flowRef.current;
      if (flow) void client.call("flows.test_stop", { flow }).catch(() => undefined);
    };
  }, [listening]);

  const start = async () => {
    setState({ phase: "starting" });
    setRun(undefined);
    let drawn: Parameters<typeof issueText>[1];
    try {
      const flow = await o.prepare();
      if (!flow) return setState({ phase: "idle" });
      const doc = await client.call("flows.graph_get", { flow });
      drawn = doc.draft ?? doc.published ?? undefined;
      if (!drawn) return setState({ phase: "idle" });
      // A test sends, calls, runs and writes for real: the same question as before it runs for good.
      const outward = await approveOutward(flow, drawn, doc.published);
      if (!outward) {
        o.say(t("flow.test.notAllowed"), true);
        return setState({ phase: "idle" });
      }
      const r = await client.call("flows.test_start", { flow, expectedDraftVersion: doc.draftVersion, outward });
      if (r.listening) setState({ phase: "listening", until: Date.parse(r.listening.until) });
      else if (r.event) {
        setState({ phase: "running", event: r.event });
        read(flow, r.event);
      }
    } catch (e) {
      setState({ phase: "idle" });
      o.say(
        issueText(e, drawn, t) ??
          t(e instanceof ApxError && e.code === "conflict" ? "flow.ed.conflict" : "flow.test.failedStart"),
        true,
      );
    }
  };
  const stop = async () => {
    const flow = o.flow;
    if (!flow) return;
    if (state.phase === "running") {
      await client.call("flows.cancel_run", { flow, event: state.event }).catch(() => undefined);
      read(flow, state.event);
      return;
    }
    setState({ phase: "idle" });
    await client.call("flows.test_stop", { flow }).catch(() => undefined);
  };
  /** Back to editing: the log closes and the drawing can change again. */
  const close = () => {
    if (state.phase === "listening") void stop();
    setState({ phase: "idle" });
    setRun(undefined);
  };
  return { state, run, active: state.phase !== "idle", start, stop, close };
}
