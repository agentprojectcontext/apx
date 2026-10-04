import { AgentAvatar, Icons } from "@apx/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useT } from "../i18n/index.ts";

/** The faces the headline cycles through, as on the website. */
const FACES = ["menta", "orbita", "parche", "cobalto", "caracol", "trino", "perla", "noche", "kiwi", "rubi"];
/** The row under the headline: the crew showing up one by one. */
const PARADE = ["coral", "zafiro", "kiwi", "noche", "orbita", "brasa", "perla", "lila", "aqua"];
const GLYPHS = "!<>-_\\/[]{}=+*^?#abcdefxyz0123456789";
const EVERY_MS = 2600;
const FACE_SIZE = { width: "100%", height: "100%" };

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** One span per character, each easing in a little after the one before (the website's headline). */
function Letters({ text, delay }: { text: string; delay: number }) {
  return (
    <span className="crew__split" aria-hidden="true">
      {[...text].map((ch, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the characters of a fixed word, in order
        <span key={i} className="crew__ch" style={{ animationDelay: `${delay + i * 0.045}s` }}>
          {ch === " " ? " " : ch}
        </span>
      ))}
    </span>
  );
}

/** The last word turns into the next through random glyphs, left to right. */
function useScramble(words: readonly string[], start: boolean): string {
  const [shown, setShown] = useState(words[0] ?? "");
  const index = useRef(0);
  useEffect(() => {
    if (!start || words.length < 2 || reducedMotion()) return;
    let frame = 0;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      const from = words[index.current % words.length] ?? "";
      index.current += 1;
      const to = words[index.current % words.length] ?? "";
      const len = Math.max(from.length, to.length);
      const began = performance.now();
      cancelAnimationFrame(frame);
      const step = (now: number) => {
        const p = Math.min(1, (now - began) / 650);
        let out = "";
        for (let i = 0; i < len; i++) {
          if (i / len < p * 1.25 - 0.15) out += to[i] ?? "";
          else if (i < to.length || p < 0.5) out += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        }
        setShown(p < 1 ? out : to);
        if (p < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    }, EVERY_MS);
    return () => {
      window.clearInterval(timer);
      cancelAnimationFrame(frame);
    };
  }, [start, words]);
  return shown;
}

/** Shows `target`, turning into each new value through random glyphs (the ticker's line). */
export function useScrambleTo(target: string): string {
  const [shown, setShown] = useState(target);
  const last = useRef(target);
  useEffect(() => {
    const from = last.current;
    last.current = target;
    if (from === target) return;
    if (reducedMotion()) {
      setShown(target);
      return;
    }
    const len = Math.max(from.length, target.length);
    const began = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - began) / 600);
      let out = "";
      for (let i = 0; i < len; i++) {
        if (i / len < p * 1.25 - 0.15) out += target[i] ?? "";
        else if (i < target.length || p < 0.5) out += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      }
      setShown(p < 1 ? out : target);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return shown;
}

/** "Meet ⟨blob⟩ your crew." — the website's hero: the headline assembles, then the face and the word keep changing. */
export function CrewHero({
  compact = false,
  pill,
  below,
}: {
  compact?: boolean;
  /** The badge above the headline; the first run's by default. */
  pill?: ReactNode;
  /** What sits under the headline; the crew lining up by default. */
  below?: ReactNode;
}) {
  const t = useT();
  const words = t("connect.heroWords").split("|");
  const [face, setFace] = useState(0);
  const [cycling, setCycling] = useState(false);
  const word = useScramble(words, cycling);

  useEffect(() => {
    if (reducedMotion()) return;
    const begin = window.setTimeout(() => setCycling(true), 2200);
    return () => window.clearTimeout(begin);
  }, []);
  useEffect(() => {
    if (!cycling) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setFace((f) => f + 1);
    }, EVERY_MS);
    return () => window.clearInterval(timer);
  }, [cycling]);

  const meet = t("setup.welcome.meet");
  const your = t("setup.welcome.your");
  return (
    <div className={`crew${compact ? " is-compact" : ""}`}>
      {pill ?? (
        <span className="wiz__pill crew__pill">
          {t("connect.pill")} <span className="is-muted">{t("connect.pillMuted")}</span>
          <span className="wiz__lock">
            <Icons.Server size={12} />
          </span>
        </span>
      )}
      <h1 className="crew__title" aria-label={`${meet} ${your} ${words[0] ?? ""}`}>
        <span className="crew__row">
          <Letters text={meet} delay={0.1} />
          <span className="crew__blob" aria-hidden="true">
            {/* A new key remounts the face, which pops in; the old one is gone at once. */}
            <AgentAvatar
              key={face}
              name="crew"
              blob={FACES[face % FACES.length]}
              className="crew__face"
              // Sized by the headline (em), so it follows the title as it shrinks.
              style={FACE_SIZE}
            />
          </span>
          <Letters text={your} delay={0.4} />
        </span>
        <span className="crew__row">
          <span className={`crew__word${cycling ? " is-sheen" : ""}`} aria-hidden="true">
            {cycling ? word : <Letters text={words[0] ?? ""} delay={0.7} />}
          </span>
        </span>
      </h1>
      {below ?? (
        <div className="crew__parade" aria-hidden="true">
          {PARADE.map((b, i) => (
            <span key={b} className="crew__member" style={{ animationDelay: `${1.1 + i * 0.09}s` }}>
              <AgentAvatar name={b} blob={b} size={44} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
