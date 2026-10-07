import "../styles/wizard.css";
import { AgentAvatar } from "@apx/ui";
import { useEffect, useRef, useState } from "react";
import logo from "../assets/logo.png";
import { useLanguage, useT } from "../i18n/index.ts";
import { useScrambleTo } from "./CrewHero.tsx";
import { startGlyphPortrait } from "./glyphPortrait.ts";

const EVERY_MS = 3200;
const REPO = "https://github.com/agentprojectcontext/apx-v2";

/** "blob|Name|what they do", one per line of the website's ticker. */
function parseStatuses(text: string): Array<{ blob: string; who: string; what: string }> {
  return text
    .split(";")
    .map((row) => row.split("|"))
    .filter((r): r is [string, string, string] => r.length === 3)
    .map(([blob, who, what]) => ({ blob, who, what }));
}

/** Who is doing what right now: a made-up crew at work, as on the website. */
function StatusTicker() {
  const t = useT();
  const all = parseStatuses(t("about.statuses"));
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setAt((i) => i + 1);
    }, EVERY_MS);
    return () => window.clearInterval(timer);
  }, []);
  const current = all[at % Math.max(all.length, 1)];
  const what = useScrambleTo(current?.what ?? "");
  if (!current) return null;
  return (
    <div className="about__status" aria-hidden="true">
      <AgentAvatar key={at} name={current.who} blob={current.blob} size={24} className="about__statusblob" />
      <b>{current.who}</b>
      <span className="about__what">{what}</span>
      <span className="about__dots">
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}

/** An agent's face drawn with the text of its own file, as in the mobile app's About. */
function GlyphPortrait() {
  const language = useLanguage();
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => (ref.current ? startGlyphPortrait(ref.current, language) : undefined), [language]);
  return (
    <div className="about__portrait" aria-hidden="true">
      <canvas ref={ref} />
    </div>
  );
}

/** The desktop app's About window: this build's versions (sent by the shell in the URL), credits and the repo. */
export function AboutScreen() {
  const t = useT();
  const params = new URLSearchParams(window.location.search);
  const version = params.get("v") ?? "";
  const rows = [
    ["about.version", version],
    ["about.electron", params.get("electron")],
    ["about.chromium", params.get("chrome")],
    ["about.node", params.get("node")],
    ["about.system", params.get("os")],
  ] as const;
  return (
    <div className="wiz about" data-apx-look="minimal" data-apx-mode="dark">
      <div className="about__side">
        <span className="wiz__pill about__version">
          <img src={logo} alt="" width={14} height={14} />
          APX {version}
        </span>
        <GlyphPortrait />
      </div>
      <div className="about__info">
        <h1 className="about__name">APX</h1>
        <p className="about__tag">{t("about.foot")}</p>
        <dl className="about__list">
          {rows.map(([label, value]) =>
            value ? (
              <div key={label}>
                <dt>{t(label)}</dt>
                <dd>{value}</dd>
              </div>
            ) : null,
          )}
        </dl>
        <p className="about__credits">{t("about.credits")}</p>
        <a className="about__repo" href={REPO} target="_blank" rel="noreferrer">
          {REPO.replace("https://", "")}
        </a>
        <StatusTicker />
      </div>
    </div>
  );
}
