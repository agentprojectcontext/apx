import { Icons, Menu, type MenuEntry } from "@apx/ui";
import { initialsOf, setPrefs, usePrefs } from "../data/prefs.ts";
import { type T, useT } from "../i18n/index.ts";
import { useLanguageItems } from "./LanguageMenu.tsx";
import { go } from "./nav.ts";
import { SIDEBAR_SECTIONS, SIDEBAR_VIEWS, toggleSidebarPart } from "./sidebarParts.ts";

/** Sidebar footer: who is using the panel, with quick theme / phone / setup / usage actions and Settings. */
export function AccountRow({ rail }: { rail: boolean }) {
  const t = useT();
  const name = usePrefs((s) => s.displayName) || t("account.you");
  const languageItems = useLanguageItems();
  const compact = usePrefs((s) => s.sidebarCompact);
  const hidden = usePrefs((s) => s.navHidden);
  const part = (p: (typeof SIDEBAR_VIEWS)[number] | (typeof SIDEBAR_SECTIONS)[number]): MenuEntry => ({
    label: t(p.label),
    checked: !hidden.includes(p.id),
    keepOpen: true,
    onSelect: () => toggleSidebarPart(p.id, hidden),
  });
  const items: MenuEntry[] = [
    { type: "label", label: name },
    {
      label: t("config.appearance"),
      icon: <Icons.Sun />,
      onSelect: () => go.config("appearance"),
    },
    { label: t("phone.open"), icon: <Icons.Smartphone />, onSelect: () => go.phone(true) },
    { label: t("sysUsage.title"), icon: <Icons.MemoryStick />, onSelect: () => go.usageDialog(true) },
    {
      label: t("appearance.compact"),
      icon: <Icons.PanelLeftClose />,
      checked: compact,
      keepOpen: true,
      onSelect: () => setPrefs({ sidebarCompact: !compact }),
    },
    {
      type: "submenu",
      label: t("nav.showInSidebar"),
      icon: <Icons.Eye />,
      items: [
        { type: "label", label: t("nav.showViews") },
        ...SIDEBAR_VIEWS.map(part),
        { type: "separator" },
        { type: "label", label: t("nav.showSections") },
        ...SIDEBAR_SECTIONS.map(part),
      ],
    },
    { type: "separator" },
    { label: t("config.title"), icon: <Icons.Settings />, shortcut: "⌘,", onSelect: () => go.config() },
    { type: "submenu", label: t("language.label"), icon: <Icons.Languages />, items: languageItems },
    ...appMenuItems(t),
  ];
  return (
    <div className={rail ? "account is-rail" : "account"}>
      <Menu
        side="top"
        align="start"
        items={items}
        trigger={
          <button type="button" className="account__btn" aria-label={t("account.menuOf", { name })}>
            <span className="account__avatar" aria-hidden="true">
              {initialsOf(name)}
            </span>
            {!rail && (
              <>
                <span className="account__name">{name}</span>
                <Icons.Ellipsis size={16} className="account__more" />
              </>
            )}
          </button>
        }
      />
    </div>
  );
}

/**
 * The desktop app's own menu (About, updates, the connection) has no menu bar on Windows and Linux: it lives here
 * there. macOS keeps it in its menu bar.
 */
function appMenuItems(t: T): MenuEntry[] {
  const desktop = window.apxDesktop;
  const run = desktop?.menuAction;
  if (!run || desktop.platform === "darwin") return [];
  return [
    { type: "separator" },
    { label: t("desktop.menu.about"), icon: <Icons.Info />, onSelect: () => run("about") },
    { label: t("desktop.menu.update"), icon: <Icons.RefreshCw />, onSelect: () => run("update") },
    { label: t("desktop.menu.connection"), icon: <Icons.ArrowRightLeft />, onSelect: () => run("change-connection") },
  ];
}
