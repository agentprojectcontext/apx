import "../styles/welcome.css";
import { Button, Dialog, IconButton, Icons } from "@apx/ui";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import slide1 from "../assets/welcome/slide-1.jpg";
import slide2 from "../assets/welcome/slide-2.jpg";
import slide3 from "../assets/welcome/slide-3.jpg";
import slide4 from "../assets/welcome/slide-4.jpg";
import slide5 from "../assets/welcome/slide-5.jpg";
import slide6 from "../assets/welcome/slide-6.jpg";
import slide7 from "../assets/welcome/slide-7.jpg";
import slide8 from "../assets/welcome/slide-8.jpg";
import slide9 from "../assets/welcome/slide-9.jpg";
import slide10 from "../assets/welcome/slide-10.jpg";
import { closeCard, useClosedCards } from "../data/cornerCards.ts";
import { useLanguage, useT } from "../i18n/index.ts";
import { enWelcome, type WelcomeKey } from "../i18n/welcome-en.ts";
import { esWelcome } from "../i18n/welcome-es.ts";
import { WELCOME_FILM, WELCOME_SLIDES } from "./welcomeFilm.ts";

// What changed since 2.14, one scene per slide, played from the docs site with no player chrome. Its titles are
// written in each language, so each has its own cut; where it cannot load, each slide's still stays in its place.
const FILM = {
  es: "https://apxagent.app/media/apx-whats-new-es.mp4",
  en: "https://apxagent.app/media/apx-whats-new-en.mp4",
};
const POSTERS = [slide1, slide2, slide3, slide4, slide5, slide6, slide7, slide8, slide9, slide10];
/** How far a finger must travel sideways to change slides. */
const SWIPE_PX = 48;

/** Said once per device and film: closing it in any way is seen, and a new film shows once again. */
export function WelcomeV2() {
  const seen = useClosedCards((s) => s.welcome === WELCOME_FILM);
  return seen ? null : <Welcome />;
}

function Welcome() {
  const t = useT();
  const es = useLanguage() === "es";
  const w = es ? esWelcome : enWelcome;
  const [at, setAt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [sound, setSound] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const touchX = useRef<number | null>(null);
  const last = WELCOME_SLIDES.length - 1;
  const slide = WELCOME_SLIDES[at] ?? WELCOME_SLIDES[0];
  const title = w[`welcome.${slide.key}.title` as WelcomeKey];
  const close = () => closeCard({ welcome: WELCOME_FILM });
  const go = (step: number) => setAt((i) => Math.max(0, Math.min(last, i + step)));

  // Each slide plays its own stretch of the film and holds its last frame.
  useEffect(() => {
    const v = video.current;
    if (!v || failed) return;
    let frame = 0;
    const watch = () => {
      if (v.currentTime >= slide.end) {
        v.pause();
        return;
      }
      frame = requestAnimationFrame(watch);
    };
    const start = () => {
      v.currentTime = slide.start;
      // Muted it may start on its own; a refused start waits for the film to be ready and tries again.
      v.play().catch(() => v.addEventListener("canplay", () => v.play().catch(() => {}), { once: true }));
      frame = requestAnimationFrame(watch);
    };
    if (v.readyState >= 1) start();
    else v.addEventListener("loadedmetadata", start, { once: true });
    return () => {
      cancelAnimationFrame(frame);
      v.removeEventListener("loadedmetadata", start);
    };
  }, [slide, failed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    // Captured: the dialog keeps the keys that reach its popup to itself.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  return (
    <Dialog
      defaultOpen
      size="lg"
      className="welcome"
      title={w["welcome.title"]}
      closeLabel={t("common.close")}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      footer={
        <>
          <Button variant="ghost" className="welcome__skip" onClick={close}>
            {w["welcome.skip"]}
          </Button>
          <span className="welcome__step">
            {w["welcome.step"].replace("{n}", String(at + 1)).replace("{total}", String(last + 1))}
          </span>
          {at > 0 && (
            <Button variant="secondary" onClick={() => go(-1)}>
              {w["welcome.back"]}
            </Button>
          )}
          {at < last ? (
            <Button onClick={() => go(1)}>{w["welcome.next"]}</Button>
          ) : (
            <Button onClick={close}>{w["welcome.cta"]}</Button>
          )}
        </>
      }
    >
      {at === last && <Confetti />}
      <div className="welcome__slide">
        <h3 className="welcome__slidetitle">{title}</h3>
        <p className="welcome__slidetext">{w[`welcome.${slide.key}.text` as WelcomeKey]}</p>
      </div>
      <div
        className="welcome__video"
        onTouchStart={(e) => {
          touchX.current = e.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(e) => {
          const from = touchX.current;
          const to = e.changedTouches[0]?.clientX;
          touchX.current = null;
          if (from == null || to == null || Math.abs(to - from) < SWIPE_PX) return;
          go(to < from ? 1 : -1);
        }}
      >
        {failed ? (
          <img src={POSTERS[at]} alt={title} />
        ) : (
          <>
            <video
              ref={video}
              src={es ? FILM.es : FILM.en}
              poster={POSTERS[at]}
              aria-label={title}
              muted={!sound}
              autoPlay
              playsInline
              preload="auto"
              onError={() => setFailed(true)}
            />
            <IconButton
              className="welcome__sound"
              variant="secondary"
              size="sm"
              label={sound ? w["welcome.soundOff"] : w["welcome.soundOn"]}
              icon={sound ? <Icons.Volume2 /> : <Icons.VolumeOff />}
              onClick={() => setSound((on) => !on)}
            />
          </>
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
    if (!colors.length) return;
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
      color: colors[i % colors.length] as string,
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
