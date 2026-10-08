import { IconButton, Icons } from "@apx/ui";
import { useEffect, useState } from "react";
import { useT } from "../i18n/index.ts";

type Activity = { kind: "look" | "click" | "type"; app: string; window: string; x?: number; y?: number };
type Frame = {
  data: string;
  bounds?: { x: number; y: number; width: number; height: number };
  app: string;
  window: string;
};
type Size = "mini" | "large" | "hidden";

const FRAME_MS = 700;
/** With no agent action for this long, the live view stops asking for frames (it keeps the last one). */
const IDLE_MS = 3 * 60_000;

/**
 * The window an agent works on, live, in a card beside the chat (desktop app only). It shows up small on the first
 * look at the screen; it grows, shrinks or hides, and marks where the agent last clicked. Frames go from the desktop
 * to this panel only.
 */
export function ScreenLive() {
  const t = useT();
  const [last, setLast] = useState<Activity & { at: number }>();
  const [frame, setFrame] = useState<Frame>();
  const [size, setSize] = useState<Size>("mini");

  useEffect(() => window.apxDesktop?.onComputerActivity?.((a) => setLast({ ...(a as Activity), at: Date.now() })), []);

  const live = Boolean(last) && size !== "hidden" && Date.now() - (last?.at ?? 0) < IDLE_MS;
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

  if (!window.apxDesktop?.computerFrame || !last) return null;
  if (size === "hidden")
    return (
      <button type="button" className="screenlive__pill" onClick={() => setSize("mini")}>
        <Icons.Monitor size={14} />
        {t("live.show")}
      </button>
    );
  const b = frame?.bounds;
  const dot =
    b && last.kind === "click" && last.x !== undefined && last.y !== undefined
      ? { left: `${((last.x - b.x) / b.width) * 100}%`, top: `${((last.y - b.y) / b.height) * 100}%` }
      : undefined;
  return (
    <section className={`screenlive screenlive--${size}`} aria-label={t("live.title")}>
      <div className="screenlive__head">
        <Icons.Monitor size={13} />
        <span className="screenlive__title">
          {frame?.app || last.app}
          {(frame?.window || last.window) && (
            <span className="screenlive__window"> · {frame?.window || last.window}</span>
          )}
        </span>
        {!live && <span className="screenlive__paused">{t("live.paused")}</span>}
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
          <img src={frame.data} alt={t("live.title")} />
        ) : (
          <div className="screenlive__wait">{t("live.wait")}</div>
        )}
        {dot && <span className="screenlive__dot" style={dot} />}
      </div>
    </section>
  );
}
