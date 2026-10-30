import { Icons, Menu, type MenuEntry } from "@apx/ui";
import { Suspense, useEffect } from "react";
import { guidesUrl, LINKS, openLink } from "../data/links.ts";
import { loadNews, openNews, useNews } from "../data/news.ts";
import { latest, words } from "../data/newsModel.ts";
import { useLanguage, useT } from "../i18n/index.ts";
import { WhatsNewDialog } from "../lazy.ts";

/** Sidebar foot, beside the account: what the last releases brought, the guides, the Discord and feedback. */
export function HelpMenu({ rail }: { rail: boolean }) {
  const t = useT();
  const lang = useLanguage();
  const entries = useNews((s) => s.entries);
  const open = useNews((s) => s.open);
  useEffect(() => void loadNews(), []);

  const recent = entries ? latest(entries) : [];
  const items: MenuEntry[] = [
    ...(recent.length
      ? ([
          { type: "label", label: t("help.whatsNew") },
          ...recent.map((e) => ({
            label: words(e.title, lang),
            shortcut: e.since,
            onSelect: () => openNews(e.id),
          })),
          { label: t("help.changelog"), icon: <Icons.Gift />, onSelect: () => openNews() },
          { type: "separator" },
        ] satisfies MenuEntry[])
      : []),
    { label: t("help.guides"), icon: <Icons.BookOpen />, onSelect: () => openLink(guidesUrl(lang)) },
    { label: t("help.discord"), icon: <Icons.MessageCircle />, onSelect: () => openLink(LINKS.discord) },
    { label: t("help.feedback"), icon: <Icons.Megaphone />, onSelect: () => openLink(LINKS.feedback) },
  ];
  return (
    <div className={rail ? "help is-rail" : "help"}>
      <Menu
        side={rail ? "right" : "top"}
        align={rail ? "end" : "start"}
        className="help__menu"
        items={items}
        onOpenChange={(o) => o && void loadNews()}
        trigger={
          <button type="button" className="help__btn" aria-label={t("help.label")} title={t("help.label")}>
            <Icons.CircleHelp size={16} />
          </button>
        }
      />
      {open && (
        <Suspense fallback={null}>
          <WhatsNewDialog />
        </Suspense>
      )}
    </div>
  );
}
