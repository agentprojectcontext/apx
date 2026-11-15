import "../styles/welcome.css";
import { Button, Dialog, IconButton, Icons } from "@apx/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import group1 from "../assets/welcome/group-1.jpg";
import group2 from "../assets/welcome/group-2.jpg";
import group3 from "../assets/welcome/group-3.jpg";
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
import { type SlideKey, seenBefore, slidesToShow, type WelcomeSlide } from "./welcomeFilm.ts";

// What is new, one feature per slide, each its own short clip with music, played from the docs site with no player
// chrome. Their titles are written in each language, so each has its own cut; where one cannot load, that slide's
// still stays in its place.
const clip = (lang: "es" | "en", key: string) => `https://apxagent.app/media/whats-new/${lang}/${key}.mp4`;
const POSTERS: Record<SlideKey, string> = {
  groups: group1,
  "group-answers": group2,
  "group-card": group3,
  sidebar: slide1,
  projects: slide2,
  routines: slide3,
  inbox: slide4,
  channels: slide5,
  signin: slide6,
  apps: slide7,
  flows: slide8,
  gauges: slide9,
  review: slide10,
};
/** How far a finger must travel sideways to change slides. */
const SWIPE_PX = 48;

/** Each slide is said once per device: closing the welcome in any way has seen the ones it held. */
export function WelcomeV2() {
  const kept = useClosedCards((s) => s.welcomeSeen);
  const film = useClosedCards((s) => s.welcome);
  const seen = useMemo(() => kept ?? seenBefore(film), [kept, film]);
  const slides = useMemo(() => slidesToShow(import.meta.env.VITE_APX_VERSION, seen), [seen]);
  if (!slides.length) return null;
  return <Welcome slides={slides} onClose={() => closeCard({ welcomeSeen: [...seen, ...slides.map((s) => s.key)] })} />;
}

function Welcome({ slides, onClose }: { slides: WelcomeSlide[]; onClose(): void }) {
  const t = useT();
  const es = useLanguage() === "es";
  const w = es ? esWelcome : enWelcome;
  const [at, setAt] = useState(0);
  const [failed, setFailed] = useState<number[]>([]);
  const [sound, setSound] = useState(false);
  const touchX = useRef<number | null>(null);
  const last = slides.length - 1;
  const slide: SlideKey = (slides[at] ?? slides[0])?.key ?? "groups";
  const title = w[`welcome.${slide}.title` as WelcomeKey];
  const close = onClose;
  const go = (step: number) => setAt((i) => Math.max(0, Math.min(last, i + step)));

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
        <p className="welcome__slidetext">{w[`welcome.${slide}.text` as WelcomeKey]}</p>
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
        {failed.includes(at) ? (
          <img src={POSTERS[slide]} alt={title} />
        ) : (
          <>
            <video
              key={slide}
              src={clip(es ? "es" : "en", slide)}
              poster={POSTERS[slide]}
              aria-label={title}
              muted={!sound}
              autoPlay
              playsInline
              preload="auto"
              onError={() => setFailed((f) => [...f, at])}
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
