// A drawn Flow's run as a log, like a terminal: the editor's test and a Flow's page show it alike (DECISIONS.md#d-178).
import { useEffect, useMemo, useRef } from "react";
import { useT } from "../i18n/index.ts";
import type { RunDetail } from "./data.ts";
import { type LogEntry, runLog } from "./run-log.ts";
import { lasted, logClock, viewGraphRun, whyText } from "./run-view.ts";
import { type FlowNode, hookPath, testPath } from "./steps.tsx";
import "./run-log.css";

/** The lines of one run; `path` is the Flow's, for the address the event came to. */
export function useRunLog(run: RunDetail | undefined, path: string, who: (n: FlowNode) => string): LogEntry[] {
  const t = useT();
  return useMemo(() => {
    if (!run) return [];
    const address = `POST ${run.test ? testPath(path) : hookPath(path)}`;
    return runLog(run, viewGraphRun(run, path, t, who), address, {
      t,
      took: lasted,
      why: (code) => whyText(code, t),
    });
  }, [run, path, t, who]);
}

const MARK: Record<NonNullable<LogEntry["tone"]> | "none", string> = {
  ok: "✓",
  err: "✗",
  live: "●",
  muted: "○",
  none: "›",
};

/** The lines, newest at the bottom; it follows new lines unless the person scrolled up to read. */
export function RunLog({ entries, waiting }: { entries: LogEntry[]; waiting?: string | undefined }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: each new line scrolls to the bottom
  useEffect(() => {
    const el = box.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [entries, waiting]);
  return (
    <div
      ref={box}
      className="rlog"
      role="log"
      aria-live="polite"
      onScroll={(e) => {
        const el = e.currentTarget;
        follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
    >
      {entries.map((e) => (
        <div key={e.key} className={`rlog__entry${e.tone ? ` is-${e.tone}` : ""}`}>
          <div className="rlog__line">
            <span className="rlog__at">{logClock(e.at)}</span>
            <span className="rlog__mark" aria-hidden="true">
              {MARK[e.tone ?? "none"]}
            </span>
            <span className="rlog__title">{e.title}</span>
          </div>
          {e.blocks.map((b) => (
            <div key={b.label} className="rlog__block">
              <span className="rlog__label">{b.label}</span>
              <pre className="rlog__text">{b.text}</pre>
            </div>
          ))}
        </div>
      ))}
      {waiting && <div className="rlog__entry is-live rlog__waiting">{waiting}</div>}
      {!entries.length && !waiting && <div className="rlog__entry is-muted">{t("flow.tlog.none")}</div>}
    </div>
  );
}
