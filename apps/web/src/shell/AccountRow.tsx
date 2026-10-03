import { Icons, Menu, type MenuEntry } from "@apx/ui";
import { initialsOf, usePrefs } from "../data/prefs.ts";
import { openSetup } from "../data/setup.ts";
import { useT } from "../i18n/index.ts";
import { go, useNav } from "./nav.ts";

/** Sidebar footer: who is using the panel, with quick theme / language / phone / config actions. */
export function AccountRow({ rail }: { rail: boolean }) {
  const t = useT();
  const name = usePrefs((s) => s.displayName) || t("account.you");
  const lang = usePrefs((s) => s.language);
  const mode = useNav((s) => s.mode);
  const items: MenuEntry[] = [
    { type: "label", label: name },
    { label: t("account.profile"), icon: <Icons.User />, onSelect: () => go.config("account") },
    {
      label: mode === "dark" ? t("theme.light") : t("theme.dark"),
      icon: mode === "dark" ? <Icons.Sun /> : <Icons.Moon />,
      onSelect: go.toggleMode,
    },
    {
      label: t("language.label"),
      icon: <Icons.Languages />,
      shortcut: lang.toUpperCase(),
      onSelect: () => go.config("appearance"),
    },
    { label: t("phone.open"), icon: <Icons.Smartphone />, onSelect: () => go.phone(true) },
    { label: t("setup.menu"), icon: <Icons.Sparkles />, onSelect: openSetup },
    { type: "separator" },
    { label: t("config.title"), icon: <Icons.Settings />, shortcut: "⌘,", onSelect: () => go.config() },
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
