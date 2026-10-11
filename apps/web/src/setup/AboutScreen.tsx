import "../styles/wizard.css";
import { AgentAvatar } from "@apx/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import logo from "../assets/logo.png";
import { elapsed } from "../common/format.ts";
import { type MessageKey, useLanguage, useT } from "../i18n/index.ts";
import { useScrambleTo } from "./CrewHero.tsx";
import { startGlyphPortrait } from "./glyphPortrait.ts";

const EVERY_MS = 3200;
const REPO = "https://github.com/agentprojectcontext/apx";

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

const SERVICE_TONE: Record<string, string> = { ok: "is-ok", degraded: "is-warn", down: "is-down" };

/** The core's subsystems as the shell read them from `/health`: "protocol:ok,browser:ok,agent:ok". */
function Services({ value }: { value: string }) {
  const services = value
    .split(",")
    .map((s) => s.split(":"))
    .filter((s): s is [string, string] => s.length === 2);
  return (
    <span className="about__services">
      {services.map(([name, status]) => (
        <span key={name} className={SERVICE_TONE[status] ?? "is-off"}>
          {name.charAt(0).toUpperCase() + name.slice(1)}
        </span>
      ))}
    </span>
  );
}

/** The desktop app's About window: this build and its core (sent by the shell in the URL), credits and the repo. */
export function AboutScreen() {
  const t = useT();
  const params = new URLSearchParams(window.location.search);
  const version = params.get("v") ?? "";
  const since = params.get("since");
  const services = params.get("services");
  const rows: Array<[MessageKey, ReactNode]> = [
    ["about.services", services ? <Services key="services" value={services} /> : t("about.coreDown")],
    ["about.core", params.get("core")],
    ["about.upFor", since ? elapsed(since) : null],
    ["about.electron", params.get("electron")],
    ["about.system", params.get("os")],
  ];
  return (
    <div className="wiz about" data-apx-look="minimal" data-apx-mode="dark">
      <h1 className="about__brand">
        <img src={logo} alt="" width={22} height={22} />
        APX
      </h1>
      <div className="about__cols">
        <GlyphPortrait />
        <div className="about__info">
          <span className="wiz__pill about__version">
            <img src={logo} alt="" width={14} height={14} />
            APX {version}
          </span>
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
        </div>
      </div>
      <StatusTicker />
      <a className="about__repo" href={REPO} target="_blank" rel="noreferrer">
        {REPO.replace("https://", "")}
      </a>
      <p className="about__legal">{t("about.legal", { year: new Date().getFullYear() })}</p>
    </div>
  );
}
