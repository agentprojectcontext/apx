import "../styles/welcome.css";
import { Button, Dialog } from "@apx/ui";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import poster from "../assets/welcome-v2.jpg";
import { closeCard, useClosedCards } from "../data/cornerCards.ts";
import { useLanguage, useT } from "../i18n/index.ts";
import { enWelcome } from "../i18n/welcome-en.ts";
import { esWelcome } from "../i18n/welcome-es.ts";

// The launch film: no voice, so one cut serves every language. Played from the docs site with no player chrome; where
// it cannot load, YouTube's no-cookie player plays it in the same place.
const FILM = "https://apxagent.app/media/apx-v2.mp4";
const YOUTUBE = "https://www.youtube-nocookie.com/embed/biFjPPuvg9o?rel=0&modestbranding=1";
const YOUTUBE_URL = "https://youtu.be/biFjPPuvg9o";

/** Said once per device: v2 is the release. The one celebration APX shows as a dialog; closing it in any way is seen. */
export function WelcomeV2() {
  const seen = useClosedCards((s) => s.welcome);
  return seen ? null : <Welcome />;
}

function Welcome() {
  const t = useT();
  const w = useLanguage() === "es" ? esWelcome : enWelcome;
  const [fallback, setFallback] = useState(false);
  const watch = () => window.open(YOUTUBE_URL, "_blank", "noopener,noreferrer");
  return (
    <Dialog
      defaultOpen
      size="lg"
      className="welcome"
      title={w["welcome.title"]}
      description={w["welcome.desc"]}
      closeLabel={t("common.close")}
      onOpenChange={(open) => {
        if (!open) closeCard({ welcome: true });
      }}
      footer={
        <>
          <Button variant="secondary" onClick={watch}>
            {w["welcome.youtube"]}
          </Button>
          <Button onClick={() => closeCard({ welcome: true })}>{w["welcome.cta"]}</Button>
        </>
      }
    >
      <Confetti />
      <div className="welcome__video">
        {fallback ? (
          <iframe
            src={YOUTUBE}
            title={w["welcome.video"]}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <video
            src={FILM}
            poster={poster}
            aria-label={w["welcome.video"]}
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
