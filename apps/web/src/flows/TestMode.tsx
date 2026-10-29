// The editor while the owner tests with a real event (DECISIONS.md#d-178): the floating controls that say what the
// test is doing, the log at the bottom and a step's card, read-only.
import { Badge, Button, IconButton, Icons, ResizeHandle, Spinner } from "@apx/ui";
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import { usePublicBase } from "./address.ts";
import { RunLog } from "./RunLog.tsx";
import type { LogEntry } from "./run-log.ts";
import type { StepView } from "./run-view.ts";
import type { TestState } from "./useFlowTest.ts";

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * The test controls, floating at the bottom of the canvas: listen for a real event (or run once now, for a schedule)
 * and simulate with sample data. While a test goes, the same pill grows upwards with what it is doing and its address.
 */
export function TestDock(props: {
  state: TestState;
  path: string;
  timed: boolean;
  disabled: boolean;
  /** Simulate with sample data, shown beside the test while nothing is going on. */
  simulate: ReactNode;
  onStart: () => void;
  onStop: () => void;
  onAgain: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const base = usePublicBase();
  const { state } = props;
  const [now, setNow] = useState(Date.now());
  const until = state.phase === "listening" ? state.until : undefined;
  useEffect(() => {
    if (!until) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);
  const url = `${base ?? ""}/flows/test/${props.path}`;
  const idle = state.phase === "idle" || state.phase === "starting";
  const label = t(props.timed ? "flow.test.now" : "flow.test.listen");
  return (
    <div className={`fe-dock is-${state.phase}`} role={idle ? undefined : "status"}>
      {state.phase === "listening" && (
        <div className="fe-dock__more">
          <div className="fe-dock__line">
            <Spinner size={14} />
            <strong>{t("flow.test.waiting")}</strong>
            <span className="fe-dock__left">{t("flow.test.left", { time: mmss(state.until - now) })}</span>
          </div>
          <div className="fe-dock__line">
            <span className="fe-dock__to">{t("flow.test.sendTo")}</span>
            <code className="fe-dock__url">{url}</code>
            <IconButton
              size="sm"
              label={t("flow.f.copy")}
              icon={<Icons.Copy size={12} />}
              onClick={() =>
                void navigator.clipboard.writeText(url).then(
                  () => notify(t("flow.f.copied"), "info"),
                  () => undefined,
                )
              }
            />
          </div>
        </div>
      )}
      {state.phase === "running" && (
        <div className="fe-dock__more">
          <div className="fe-dock__line">
            <Spinner size={14} />
            <strong>{t("flow.test.running")}</strong>
          </div>
        </div>
      )}
      {state.phase === "done" && (
        <div className="fe-dock__more">
          <div className="fe-dock__line">
            <strong>{t(state.said)}</strong>
          </div>
        </div>
      )}
      <div className="fe-dock__bar">
        {idle && (
          <>
            <Button
              variant="secondary"
              className="fe-dock__test"
              leadingIcon={state.phase === "starting" ? <Spinner size={14} /> : <Icons.Play size={14} />}
              disabled={props.disabled || state.phase === "starting"}
              aria-label={label}
              onClick={props.onStart}
            >
              {label}
            </Button>
            {props.simulate}
          </>
        )}
        {state.phase === "listening" && (
          <Button size="sm" variant="secondary" leadingIcon={<Icons.Square size={12} />} onClick={props.onStop}>
            {t("flow.test.stop")}
          </Button>
        )}
        {state.phase === "running" && (
          <Button size="sm" variant="secondary" leadingIcon={<Icons.Square size={12} />} onClick={props.onStop}>
            {t("flow.test.stopRun")}
          </Button>
        )}
        {state.phase === "done" && (
          <>
            <Button size="sm" variant="secondary" leadingIcon={<Icons.Play size={12} />} onClick={props.onAgain}>
              {t(props.timed ? "flow.test.againNow" : "flow.test.again")}
            </Button>
            <Button size="sm" leadingIcon={<Icons.Pencil size={12} />} onClick={props.onClose}>
              {t("flow.test.edit")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

const LOG = { min: 120, max: 560, initial: 240 };

/** Where the log sits now: its height, and how much of the canvas it lies over (a sheet on a phone; 0 beside it). */
export type LogPlace = { height: number; over: number };

/**
 * The log at the bottom, like a terminal: it can be made taller, folded, or closed to go back to editing. `onPlace`
 * hears where it settled after each change, so the canvas fits its steps in what stays visible.
 */
export function TestLog(props: {
  entries: LogEntry[];
  waiting: string | undefined;
  onClose: () => void;
  onPlace: (place: LogPlace | null) => void;
}) {
  const t = useT();
  const [height, setHeight] = useState(LOG.initial);
  const [open, setOpen] = useState(true);
  const box = useRef<HTMLElement>(null);
  const onPlace = useRef(props.onPlace);
  onPlace.current = props.onPlace;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Settled, not every pixel of a drag: the canvas has its new size by then.
    const said = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const h = Math.round(el.getBoundingClientRect().height);
        onPlace.current({ height: h, over: getComputedStyle(el).position === "absolute" ? h : 0 });
      }, 120);
    });
    said.observe(el);
    return () => {
      clearTimeout(timer);
      said.disconnect();
      onPlace.current(null);
    };
  }, []);
  return (
    <section
      ref={box}
      className={open ? "fe-log" : "fe-log is-folded"}
      style={{ "--fe-log": `${height}px` } as CSSProperties}
      aria-label={t("flow.tlog.title")}
    >
      {open && (
        <ResizeHandle
          edge="top"
          width={height}
          min={LOG.min}
          max={LOG.max}
          onResize={setHeight}
          onReset={() => setHeight(LOG.initial)}
          label={t("flow.tlog.resize")}
        />
      )}
      <header className="fe-log__head">
        <Icons.Terminal size={14} aria-hidden="true" />
        <strong>{t("flow.tlog.title")}</strong>
        <Badge tone="neutral">{t("flow.test.badge")}</Badge>
        <span className="fe-log__spacer" />
        <IconButton
          size="sm"
          label={t(open ? "flow.collapse" : "flow.expand")}
          icon={open ? <Icons.ChevronDown size={14} /> : <Icons.ChevronUp size={14} />}
          onClick={() => setOpen((o) => !o)}
        />
        <IconButton size="sm" label={t("common.close")} icon={<Icons.X size={14} />} onClick={props.onClose} />
      </header>
      {open && <RunLog entries={props.entries} waiting={props.waiting} />}
    </section>
  );
}

/** A step's card while testing: what it was given and gave back in this run, nothing to change. */
export function TestStepCard({ step }: { step: StepView | undefined }) {
  const t = useT();
  return (
    <div className="fe-tstep">
      <p className="fe-note">{t("flow.test.readOnly")}</p>
      {step?.badge && (
        <Badge tone={step.state === "failed" ? "danger" : step.state === "live" ? "info" : "neutral"}>
          {step.badge}
        </Badge>
      )}
      <div className="fe-tstep__io">
        <span className="fe-ins__label">{t("flow.input")}</span>
        <pre>{step?.input || "—"}</pre>
      </div>
      <div className="fe-tstep__io">
        <span className="fe-ins__label">{t("flow.output")}</span>
        <pre className={step?.state === "failed" ? "is-failed" : undefined}>
          {step?.state ? step.output || "—" : t("flow.test.notYet")}
        </pre>
      </div>
    </div>
  );
}
