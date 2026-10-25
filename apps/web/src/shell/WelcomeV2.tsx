import "../styles/welcome.css";
import { Button, Dialog, Icons } from "@apx/ui";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import poster from "../assets/welcome-v2.jpg";
import { closeCard } from "../data/cornerCards.ts";
import { useT } from "../i18n/index.ts";

// The launch film: no voice, so one cut serves every language. Played from the docs site with no player chrome; where
// it cannot load, its still (shipped with the panel) opens it on YouTube.
const FILM = "https://agentprojectcontext.github.io/apx/v2/media/apx-v2.mp4";
const YOUTUBE_URL = "https://youtu.be/biFjPPuvg9o";

/** Said once per device: v2 left the beta. The one celebration APX shows as a dialog; closing it in any way is seen. */
export function WelcomeV2() {
  const t = useT();
  const [fallback, setFallback] = useState(false);
  const watch = () => window.open(YOUTUBE_URL, "_blank", "noopener,noreferrer");
  return (
    <Dialog
      defaultOpen
      size="lg"
      className="welcome"
      title={t("welcome.title")}
      description={t("welcome.desc")}
      closeLabel={t("common.close")}
      onOpenChange={(open) => {
        if (!open) closeCard({ welcome: true });
      }}
      footer={
        <>
          <Button variant="secondary" onClick={watch}>
            {t("welcome.youtube")}
          </Button>
          <Button onClick={() => closeCard({ welcome: true })}>{t("welcome.cta")}</Button>
        </>
      }
    >
      <Confetti />
      <div className="welcome__video">
        {fallback ? (
          <button type="button" className="welcome__still" onClick={watch} aria-label={t("welcome.youtube")}>
            <img src={poster} alt="" />
            <span className="welcome__play">
              <Icons.Play size={28} />
            </span>
          </button>
        ) : (
          <video
            src={FILM}
            poster={poster}
            aria-label={t("welcome.video")}
            autoPlay
            muted
            loop
            playsInline
            controls
            onError={() => setFallback(true)}
          />
        )}
      </div>
    </Dialog>
  );
}

const TONES = ["--apx-brand", "--apx-accent", "--apx-info", "--apx-warning", "--apx-danger"];

/** One burst from the top of the window, drawn on a canvas that leaves once the last piece has fallen. */
function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !anchor.current || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // The tokens are set on the app's root, not on the document: read them where the dialog sits.
    const css = getComputedStyle(anchor.current);
    const colors = TONES.map((v) => css.getPropertyValue(v).trim()).filter(Boolean);
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    const pieces = Array.from({ length: 160 }, (_, i) => ({
      x: w / 2 + (Math.random() - 0.5) * w * 0.3,
      y: h * 0.2,
      vx: (Math.random() - 0.5) * 14,
      vy: -Math.random() * 12 - 4,
      size: 5 + Math.random() * 6,
      spin: Math.random() * Math.PI,
      turn: (Math.random() - 0.5) * 0.3,
      color: colors[i % colors.length] ?? "#7c5cff",
    }));
    let frame = 0;
    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      let alive = 0;
      for (const p of pieces) {
        p.vy += 0.28;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.spin += p.turn;
        if (p.y > h + 20) continue;
        alive++;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.spin);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      if (alive) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  // Outside the popup: its open animation transforms it, and a fixed canvas inside would fall within it only.
  return (
    <>
      <span ref={anchor} hidden />
      {createPortal(<canvas ref={ref} className="welcome__confetti" aria-hidden />, document.body)}
    </>
  );
}
