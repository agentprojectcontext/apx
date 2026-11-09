import { Icons, Menu, type MenuEntry } from "@apx/ui";
import { Suspense, useEffect } from "react";
import { guidesUrl, LINKS, openLink } from "../data/links.ts";
import { loadNews, openNews, useNews } from "../data/news.ts";
import { isUnread, latest, unreadOf, words } from "../data/newsModel.ts";
import { useLanguage, useT } from "../i18n/index.ts";
import { WhatsNewDialog } from "../lazy.ts";

/** Sidebar foot, beside the account: what the last releases brought, the guides, the Discord and feedback. */
export function HelpMenu({ rail }: { rail: boolean }) {
  const t = useT();
  const lang = useLanguage();
  const entries = useNews((s) => s.entries);
  const open = useNews((s) => s.open);
  const read = useNews((s) => s.read);
  const unread = entries ? unreadOf(entries, read) : [];
  const fresh = unread.length > 0;
  useEffect(() => void loadNews(), []);

  const recent = entries ? latest(entries) : [];
  // Unread ones the menu has no line for: "All the news" says so, since opening it reads them all.
  const more = unread.filter((e) => !recent.includes(e)).length;
  const items: MenuEntry[] = [
    ...(recent.length
      ? ([
          { type: "label", label: t("help.whatsNew") },
          ...recent.map((e) => {
            const isNew = Boolean(entries && isUnread(e, entries, read));
            return {
              // Unread ones carry a dot until opened; read ones keep its place, so the titles stay in line.
              icon: isNew ? (
                <span className="help__newsdot is-unread" role="img" aria-label={t("help.unread")} />
              ) : (
                <span className="help__newsdot" aria-hidden="true" />
              ),
              label: words(e.title, lang),
              shortcut: e.since,
              onSelect: () => openNews(e.id),
            };
          }),
          {
            label: more ? (
              <span className="help__all">
                {t("help.changelog")}
                <span className="help__more">{t("help.moreUnread", { n: more })}</span>
              </span>
            ) : (
              t("help.changelog")
            ),
            icon: <Icons.Gift />,
            onSelect: () => openNews(),
          },
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
          <button
            type="button"
            className="help__btn"
            aria-label={fresh ? t("help.labelNew") : t("help.label")}
            title={fresh ? t("help.labelNewHint") : t("help.label")}
          >
            <Icons.CircleHelp size={16} />
            {fresh && <span className="help__dot" aria-hidden="true" />}
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
