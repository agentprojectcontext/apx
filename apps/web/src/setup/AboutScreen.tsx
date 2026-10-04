import { AgentAvatar } from "@apx/ui";
import { useEffect, useState } from "react";
import logo from "../assets/logo.png";
import { useT } from "../i18n/index.ts";
import { CrewHero, useScrambleTo } from "./CrewHero.tsx";

const EVERY_MS = 3200;

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
      <AgentAvatar key={at} name={current.who} blob={current.blob} size={28} className="about__statusblob" />
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

/** The desktop app's About window: the first run's hero, with this build's version in the badge. */
export function AboutScreen() {
  const t = useT();
  const version = new URLSearchParams(window.location.search).get("v") ?? "";
  return (
    <div className="wiz is-connect about" data-apx-look="minimal" data-apx-mode="dark">
      <div className="about__stage">
        <CrewHero
          pill={
            <span className="wiz__pill crew__pill about__version">
              <img src={logo} alt="" width={14} height={14} />
              APX {version}
            </span>
          }
          below={<StatusTicker />}
        />
        <p className="about__foot">{t("about.foot")}</p>
      </div>
    </div>
  );
}
