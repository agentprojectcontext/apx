import { Button, IconButton, Icons } from "@apx/ui";
import { type PointerEvent, useEffect, useRef, useState } from "react";
import { useT } from "../i18n/index.ts";
import { ComputerIcon } from "./parts/ComputerIcon.tsx";

type Activity = { kind: "look" | "click" | "type"; app: string; window: string; x?: number; y?: number };
type Frame = {
  data: string;
  bounds?: { x: number; y: number; width: number; height: number };
  app: string;
  window: string;
};
type Size = "mini" | "large" | "hidden";
type Offset = { x: number; y: number };

const FRAME_MS = 700;
/** With no agent action for this long, computer use is over: the card closes and its place is forgotten. */
const IDLE_MS = 3 * 60_000;
const HOME: Offset = { x: 0, y: 0 };

/**
 * The window an agent works on, live, in a card over the chat (desktop app only). It starts small at the bottom; it
 * moves by its title bar within the chat, grows, shrinks or hides into a pill at the top, and marks where the agent
 * last clicked. When computer use ends it closes, and the next time it starts at the bottom again. Frames go from the
 * desktop to this panel only.
 */
export function ScreenLive() {
  const t = useT();
  const [last, setLast] = useState<Activity & { at: number }>();
  const [frame, setFrame] = useState<Frame>();
  const [size, setSize] = useState<Size>("mini");
  const [offset, setOffset] = useState<Offset>(HOME);
  const [stopped, setStopped] = useState(false);
  const card = useRef<HTMLElement>(null);
  const drag = useRef<{ px: number; py: number; from: Offset } | undefined>(undefined);

  useEffect(
    () =>
      window.apxDesktop?.onComputerActivity?.((a) =>
        setLast((prev) => {
          // A new session (none running): back to its place at the bottom, small.
          if (!prev) {
            setOffset(HOME);
            setSize("mini");
          }
          return { ...(a as Activity), at: Date.now() };
        }),
      ),
    [],
  );

  // The emergency stop, pulled here or with ⌘⇧Esc from any app.
  useEffect(() => {
    void window.apxDesktop?.computerStopped?.().then(
      (s) => setStopped(s === true),
      () => {},
    );
    return window.apxDesktop?.onComputerStopped?.(setStopped);
  }, []);

  // Computer use is over after a while with no action: close, forget where it was moved.
  useEffect(() => {
    if (!last) return;
    const id = setTimeout(() => {
      setLast(undefined);
      setFrame(undefined);
    }, IDLE_MS);
    return () => clearTimeout(id);
  }, [last]);

  const live = Boolean(last) && size !== "hidden";
  useEffect(() => {
    const desktop = window.apxDesktop;
    if (!live || !desktop?.computerFrame) return;
    let stop = false;
    const tick = async () => {
      const f = (await desktop.computerFrame?.().catch(() => undefined)) as Frame | undefined;
      if (stop) return;
      if (f) setFrame(f);
      setTimeout(() => void tick(), FRAME_MS);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [live]);

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    drag.current = { px: e.clientX, py: e.clientY, from: offset };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = card.current;
    const area = el?.parentElement?.getBoundingClientRect();
    if (!d || !el || !area) return;
    // Within the chat: the card's own default spot is the bottom right, so it moves up and to the left from there.
    const box = el.getBoundingClientRect();
    const w = box.width;
    const h = box.height;
    const x = Math.min(0, Math.max(-(area.width - w - 32), d.from.x + e.clientX - d.px));
    const y = Math.min(0, Math.max(-(area.height - h - 112), d.from.y + e.clientY - d.py));
    setOffset({ x, y });
  };
  const onUp = () => {
    drag.current = undefined;
  };

  if (!window.apxDesktop?.computerFrame || !last) return null;
  if (size === "hidden")
    return (
      <button type="button" className="screenlive__pill" onClick={() => setSize("mini")}>
        <ComputerIcon busy size={14} />
        {t("live.show")}
      </button>
    );
  const b = frame?.bounds;
  const dot =
    b && last.kind === "click" && last.x !== undefined && last.y !== undefined
      ? { left: `${((last.x - b.x) / b.width) * 100}%`, top: `${((last.y - b.y) / b.height) * 100}%` }
      : undefined;
  return (
    <section
      ref={card}
      className={`screenlive screenlive--${size}`}
      aria-label={t("live.title")}
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
    >
      <div className="screenlive__head" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
        <ComputerIcon busy size={14} />
        <span className="screenlive__title">
          {frame?.app || last.app}
          {(frame?.window || last.window) && (
            <span className="screenlive__window"> · {frame?.window || last.window}</span>
          )}
        </span>
        {!stopped && (
          // Small and quiet until the pointer is on it: then it opens and says what it does.
          <button
            type="button"
            className="screenlive__stop"
            aria-label={t("live.stopHint")}
            onClick={() => void window.apxDesktop?.stopComputer?.()}
          >
            <Icons.Square size={10} />
            <span className="screenlive__stoplabel">{t("live.stop")}</span>
          </button>
        )}
        <IconButton
          size="sm"
          label={size === "mini" ? t("live.bigger") : t("live.smaller")}
          icon={size === "mini" ? <Icons.Maximize2 size={13} /> : <Icons.Minimize2 size={13} />}
          onClick={() => setSize(size === "mini" ? "large" : "mini")}
        />
        <IconButton
          size="sm"
          label={t("live.hide")}
          icon={<Icons.EyeOff size={13} />}
          onClick={() => setSize("hidden")}
        />
      </div>
      <div className="screenlive__view">
        {frame ? (
          <img src={frame.data} alt={t("live.title")} draggable={false} />
        ) : (
          <div className="screenlive__wait">{t("live.wait")}</div>
        )}
        {dot && !stopped && <span className="screenlive__dot" style={dot} />}
        {stopped && (
          <div className="screenlive__stopped" role="status">
            <span>{t("live.stopped")}</span>
            <Button size="sm" onClick={() => void window.apxDesktop?.resumeComputer?.()}>
              {t("live.resume")}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
