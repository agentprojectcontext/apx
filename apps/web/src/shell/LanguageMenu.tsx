import { Icons, Menu } from "@apx/ui";
import { setPrefs } from "../data/prefs.ts";
import { LANGUAGE_NAMES, LANGUAGES, useLanguage, useT } from "../i18n/index.ts";

/** The language choices as menu items, for a menu of their own or folded into another. */
export function useLanguageItems() {
  const t = useT();
  const lang = useLanguage();
  return [
    { type: "label" as const, label: t("language.label") },
    ...LANGUAGES.map((l) => ({
      label: LANGUAGE_NAMES[l],
      icon: l === lang ? <Icons.Check /> : <span />,
      onSelect: () => setPrefs({ language: l }),
    })),
  ];
}

/** The panel's language, picked from a short menu (the top bar's and the setup's); kept per device in the prefs. */
export function LanguageMenu({ className }: { className: string }) {
  const t = useT();
  const lang = useLanguage();
  const items = useLanguageItems();
  return (
    <Menu
      align="end"
      items={items}
      trigger={
        <button
          type="button"
          className={className}
          aria-label={t("language.current", { language: LANGUAGE_NAMES[lang] })}
        >
          <Icons.Languages size={14} />
          {lang.toUpperCase()}
        </button>
      }
    />
  );
}
