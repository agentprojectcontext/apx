import "../styles/whats-new.css";
import { Button, Dialog, Icons } from "@apx/ui";
import { useEffect, useRef, useState } from "react";
import { send } from "../data/actions.ts";
import { secretary } from "../data/identity.ts";
import { LINKS, openLink } from "../data/links.ts";
import { closeNews, useNews } from "../data/news.ts";
import { byRelease, type NewsItem, words } from "../data/newsModel.ts";
import { useData } from "../data/state.ts";
import { useLanguage, useT } from "../i18n/index.ts";
import { go } from "./nav.ts";

const HOME = "home";

/** Every release's news for this owner, newest first: the one picked in the Help menu open, each with what to ask. */
export function WhatsNewDialog() {
  const t = useT();
  const entries = useNews((s) => s.entries) ?? [];
  const opened = useNews((s) => s.open);
  const releases = byRelease(entries);
  const first = opened && opened !== "all" ? opened : releases[0]?.entries[0]?.id;
  const [expanded, setExpanded] = useState<string | undefined>(first);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && closeNews()}
      size="lg"
      title={t("help.whatsNew")}
      closeLabel={t("common.close")}
      className="whatsnew"
      footer={
        <Button variant="ghost" size="sm" onClick={() => openLink(LINKS.releases)}>
          {t("help.allChanges")}
          <Icons.ExternalLink size={13} />
        </Button>
      }
    >
      {releases.map((r) => (
        <section key={r.version} className="whatsnew__release">
          <h3 className="whatsnew__version">{t("help.release", { v: r.version })}</h3>
          {r.entries.map((e) => (
            <Entry
              key={e.id}
              entry={e}
              open={expanded === e.id}
              scroll={e.id === first}
              onToggle={() => setExpanded(expanded === e.id ? undefined : e.id)}
            />
          ))}
        </section>
      ))}
    </Dialog>
  );
}

function Entry({
  entry,
  open,
  scroll,
  onToggle,
}: {
  entry: NewsItem;
  open: boolean;
  scroll: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const lang = useLanguage();
  const boss = useData((s) => secretary(s.agents));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scroll) ref.current?.scrollIntoView({ block: "nearest" });
  }, [scroll]);
  const ask = (prompt: string) => {
    closeNews();
    go.thread(HOME);
    void send(HOME, prompt);
  };
  return (
    <div ref={ref} className={open ? "whatsnew__entry is-open" : "whatsnew__entry"}>
      <button type="button" className="whatsnew__head" aria-expanded={open} onClick={onToggle}>
        <span className="whatsnew__title">{words(entry.title, lang)}</span>
        <Icons.ChevronDown size={14} className="whatsnew__chev" />
      </button>
      {open && (
        <div className="whatsnew__body">
          <p className="whatsnew__about">{words(entry.about, lang)}</p>
          {entry.actions.length > 0 && boss && (
            <div className="whatsnew__ask">
              <span className="whatsnew__askLabel">{t("help.ask", { name: boss.name })}</span>
              {entry.actions.map((a) => (
                <Button key={a.prompt} size="sm" variant="secondary" onClick={() => ask(a.prompt)}>
                  <Icons.Sparkles size={13} />
                  {words(a.label, lang)}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
