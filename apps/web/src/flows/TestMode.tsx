// The editor while the owner tests with a real event (DECISIONS.md#d-178): the button in the top bar, the strip that
// says what the test is doing, the log at the bottom and a step's card, read-only.
import { Badge, Button, IconButton, Icons, ResizeHandle, Spinner } from "@apx/ui";
import { type CSSProperties, useEffect, useState } from "react";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import { usePublicBase } from "./address.ts";
import { RunLog } from "./RunLog.tsx";
import type { LogEntry } from "./run-log.ts";
import type { StepView } from "./run-view.ts";
import type { TestState } from "./useFlowTest.ts";

/** Listen for an event (a webhook Flow) or run once now (a schedule one). */
export function TestButton(props: { timed: boolean; state: TestState; disabled: boolean; onStart: () => void }) {
  const t = useT();
  const going = props.state.phase !== "idle";
  const label = t(props.timed ? "flow.test.now" : "flow.test.listen");
  return (
    <Button
      variant="secondary"
      className="fe-top__test"
      leadingIcon={props.state.phase === "starting" ? <Spinner size={14} /> : <Icons.Play size={14} />}
      disabled={props.disabled || going}
      aria-label={label}
      onClick={props.onStart}
    >
      <span className="fe-top__test-text">{label}</span>
      <span className="fe-top__test-short" aria-hidden="true">
        {t("flow.test.listenShort")}
      </span>
    </Button>
  );
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** What the test is doing, under the top bar: waiting at its address, running, or how it ended. */
export function TestStrip(props: {
  state: TestState;
  path: string;
  timed: boolean;
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
  if (state.phase === "idle" || state.phase === "starting") return null;
  const url = `${base ?? ""}/flows/test/${props.path}`;
  return (
    <div className={`fe-test is-${state.phase}`} role="status">
      {state.phase === "listening" && (
        <>
          <Spinner size={14} />
          <strong>{t("flow.test.waiting")}</strong>
          <span className="fe-test__to">{t("flow.test.sendTo")}</span>
          <code className="fe-test__url">{url}</code>
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
          <span className="fe-test__left">{t("flow.test.left", { time: mmss(state.until - now) })}</span>
          <span className="fe-test__spacer" />
          <Button size="sm" variant="secondary" leadingIcon={<Icons.Square size={12} />} onClick={props.onStop}>
            {t("flow.test.stop")}
          </Button>
        </>
      )}
      {state.phase === "running" && (
        <>
          <Spinner size={14} />
          <strong>{t("flow.test.running")}</strong>
          <span className="fe-test__spacer" />
          <Button size="sm" variant="secondary" leadingIcon={<Icons.Square size={12} />} onClick={props.onStop}>
            {t("flow.test.stopRun")}
          </Button>
        </>
      )}
      {state.phase === "done" && (
        <>
          <strong>{t(state.said)}</strong>
          <span className="fe-test__spacer" />
          <Button size="sm" variant="secondary" leadingIcon={<Icons.Play size={12} />} onClick={props.onAgain}>
            {t(props.timed ? "flow.test.againNow" : "flow.test.again")}
          </Button>
          <Button size="sm" leadingIcon={<Icons.Pencil size={12} />} onClick={props.onClose}>
            {t("flow.test.edit")}
          </Button>
        </>
      )}
    </div>
  );
}

const LOG = { min: 120, max: 560, initial: 240 };

/** The log at the bottom, like a terminal: it can be made taller, folded, or closed to go back to editing. */
export function TestLog(props: { entries: LogEntry[]; waiting: string | undefined; onClose: () => void }) {
  const t = useT();
  const [height, setHeight] = useState(LOG.initial);
  const [open, setOpen] = useState(true);
  return (
    <section
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
        <span className="fe-test__spacer" />
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
